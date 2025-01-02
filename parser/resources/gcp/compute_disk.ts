import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class ComputeDisk implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class ComputeDiskQuery implements ResourceQuery<ComputeDisk> {
  private address: string;
  private region: string;
  private type: string;
  private size: number;
  private iops: number;

  private computeDiskCostQuery: ProductQuery;
  private computeDiskIOPSCostQuery?: ProductQuery;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.region = this.zoneToRegion(resource.hclBlock.zone);
    this.type = resource.hclBlock.type;
    this.size = this.computeDiskSize(resource, allResources);
    this.iops = resource.hclBlock.iops || 0;

    this.computeDiskCostQuery = this.createComputeDiskCostQuery();
    if (this.type === "pd-extreme" || this.type === "hyperdisk-extreme") {
      this.computeDiskIOPSCostQuery = this.createComputeDiskIOPSCostQuery();
    }
  }

  zoneToRegion(zone: string): string {
    return zone.slice(0, -2);
  }

  async fetchCosts(client: CostApiClient): Promise<ComputeDisk> {
    const costQueries: ProductQuery[] = [this.computeDiskCostQuery];

    if (this.computeDiskIOPSCostQuery) {
      costQueries.push(this.computeDiskIOPSCostQuery);
    }

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === this.computeDiskCostQuery) {
        const computeDiskCost =
          result.products[0].prices && result.products[0].prices[0];
        fixedCosts.push({
          name: this.getDiskTypeLabel(),
          quantity: this.size,
          usd: parseFloat(computeDiskCost?.usd || "0"),
          unit: computeDiskCost?.unit || "gigabyte month",
          monthlyCost: this.size * parseFloat(computeDiskCost?.usd || "0"),
        });
      } else if (result.query === this.computeDiskIOPSCostQuery) {
        const computeDiskIOPSCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Provisioned IOPS",
          unit: computeDiskIOPSCost?.unit || "IOPS",
          defaultUnits: this.iops,
          computeCost: (units: number) =>
            units * parseFloat(computeDiskIOPSCost?.usd || "0"),
        });
      }
    });

    return new ComputeDisk(fixedCosts, dynamicCosts);
  }

  private createComputeDiskCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Compute Engine",
        productFamily: "Storage",
        attributeFilters: [
          {
            key: "description",
            valueRegex: this.getDiskTypeDesc(),
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private createComputeDiskIOPSCostQuery(): ProductQuery | undefined {
    const iopsTypeDesc = this.getIOPSTypeDesc();
    if (!iopsTypeDesc) {
      return undefined;
    }

    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Compute Engine",
        productFamily: "Storage",
        attributeFilters: [
          {
            key: "description",
            valueRegex: iopsTypeDesc,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private getDiskTypeDesc(): string {
    switch (this.type) {
      case "pd-balanced":
        return "/^Balanced PD Capacity/";
      case "pd-ssd":
        return "/^SSD backed PD Capacity/";
      case "pd-extreme":
        return "/^Extreme PD Capacity/";
      case "hyperdisk-extreme":
        return "/^Hyperdisk Extreme Capacity( in .*)?$/";
      default:
        return "/^Storage PD Capacity/";
    }
  }

  private getDiskTypeLabel(): string {
    switch (this.type) {
      case "pd-balanced":
        return "Balanced provisioned storage (pd-balanced)";
      case "pd-ssd":
        return "SSD provisioned storage (pd-ssd)";
      case "pd-extreme":
        return "Extreme provisioned storage (pd-extreme)";
      case "hyperdisk-extreme":
        return "Hyperdisk provisioned storage (hyperdisk-extreme)";
      default:
        return "Standard provisioned storage (pd-standard)";
    }
  }

  private getIOPSTypeDesc(): string | undefined {
    switch (this.type) {
      case "pd-extreme":
        return "/^Extreme PD IOPS/";
      case "hyperdisk-extreme":
        return "/^Hyperdisk Extreme IOPS( in .*)?$/";
      default:
        return undefined;
    }
  }

  private computeDiskSize(
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ): number {
    if (resource.hclBlock.size) {
      return resource.hclBlock.size;
    }

    if (resource.hclBlock.image && allResources[resource.hclBlock.image]) {
      return this.computeImageDiskSize(allResources[resource.hclBlock.image]);
    }

    if (
      resource.hclBlock.snapshot &&
      allResources[resource.hclBlock.snapshot]
    ) {
      return this.computeSnapshotDiskSize(
        allResources[resource.hclBlock.snapshot],
      );
    }

    return this.defaultDiskSize(resource.hclBlock.type);
  }

  private defaultDiskSize(diskType: string): number {
    diskType = diskType.toLowerCase();
    if (diskType === "pd-balanced" || diskType === "pd-ssd") {
      return 100;
    }

    if (diskType === "pd-extreme" || diskType === "hyperdisk-extreme") {
      return 1000;
    }

    return 500;
  }

  private computeImageDiskSize(resource: HCLResource): number {
    if (resource.hclBlock.disk_size_gb) {
      return resource.hclBlock.disk_size_gb;
    }

    if (resource.hclBlock.source_disk) {
      return this.computeDiskSize(resource.hclBlock.source_disk, {});
    }

    if (resource.hclBlock.source_image) {
      return this.computeImageDiskSize(resource.hclBlock.source_image);
    }

    if (resource.hclBlock.source_snapshot) {
      return this.computeSnapshotDiskSize(resource.hclBlock.source_snapshot);
    }

    return 0;
  }

  private computeSnapshotDiskSize(resource: HCLResource): number {
    if (resource.hclBlock.source_disk) {
      return this.computeDiskSize(resource.hclBlock.source_disk, {});
    }

    return 0;
  }
}
