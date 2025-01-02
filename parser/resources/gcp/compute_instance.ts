import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class ComputeInstance implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class ComputeInstanceQuery implements ResourceQuery<ComputeInstance> {
  private address: string;
  private region: string;
  private machineType: string;
  private purchaseOption: string;
  private size: number;
  private hasBootDisk: boolean;
  private bootDiskSize: number;
  private bootDiskType: string;
  private scratchDisks: number;
  private guestAccelerators: { type: string; count: number }[];
  private monthlyHours?: number;

  private instanceUsageCostQuery: ProductQuery;
  private bootDiskCostQuery?: ProductQuery;
  private scratchDiskCostQuery?: ProductQuery;
  private guestAcceleratorCostQueries: ProductQuery[];

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.region = this.zoneToRegion(resource.hclBlock.zone);
    this.machineType = resource.hclBlock.machine_type;
    this.purchaseOption = resource.hclBlock.purchase_option;
    this.size = resource.hclBlock.size;
    this.hasBootDisk = resource.hclBlock.has_boot_disk;
    this.bootDiskSize = resource.hclBlock.boot_disk_size;
    this.bootDiskType = resource.hclBlock.boot_disk_type;
    this.scratchDisks = resource.hclBlock.scratch_disks;
    this.guestAccelerators = resource.hclBlock.guest_accelerators || [];
    this.monthlyHours = resource.hclBlock.monthly_hrs;

    this.instanceUsageCostQuery = this.createInstanceUsageCostQuery();
    this.bootDiskCostQuery = this.createBootDiskCostQuery();
    this.scratchDiskCostQuery = this.createScratchDiskCostQuery();
    this.guestAcceleratorCostQueries = this.createGuestAcceleratorCostQueries();
  }

  zoneToRegion(zone: string): string {
    return zone.slice(0, -2);
  }

  async fetchCosts(client: CostApiClient): Promise<ComputeInstance> {
    const costQueries: ProductQuery[] = [this.instanceUsageCostQuery];

    if (this.bootDiskCostQuery) {
      costQueries.push(this.bootDiskCostQuery);
    }

    if (this.scratchDiskCostQuery) {
      costQueries.push(this.scratchDiskCostQuery);
    }

    costQueries.push(...this.guestAcceleratorCostQueries);

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === this.instanceUsageCostQuery) {
        const instanceUsageCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: `Instance usage (Linux/UNIX, ${this.purchaseOption}, ${this.machineType})`,
          unit: instanceUsageCost?.unit || "hours",
          defaultUnits: this.monthlyHours || 730,
          computeCost: (units: number) =>
            units * parseFloat(instanceUsageCost?.usd || "0"),
        });
      } else if (result.query === this.bootDiskCostQuery) {
        const bootDiskCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: `Boot disk (${this.bootDiskType})`,
          unit: bootDiskCost?.unit || "GB",
          defaultUnits: this.bootDiskSize,
          computeCost: (units: number) =>
            units * parseFloat(bootDiskCost?.usd || "0"),
        });
      } else if (result.query === this.scratchDiskCostQuery) {
        const scratchDiskCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Local SSD provisioned storage",
          unit: scratchDiskCost?.unit || "GB",
          defaultUnits: 375 * this.scratchDisks,
          computeCost: (units: number) =>
            units * parseFloat(scratchDiskCost?.usd || "0"),
        });
      } else {
        this.guestAcceleratorCostQueries.forEach((query, index) => {
          if (result.query === query) {
            const guestAcceleratorCost =
              result.products[0].prices && result.products[0].prices[0];
            dynamicCosts.push({
              name: `Guest accelerator (${this.guestAccelerators[index].type})`,
              unit: guestAcceleratorCost?.unit || "hours",
              defaultUnits: this.monthlyHours || 730,
              computeCost: (units: number) =>
                units * parseFloat(guestAcceleratorCost?.usd || "0"),
            });
          }
        });
      }
    });

    return new ComputeInstance(fixedCosts, dynamicCosts);
  }

  private createInstanceUsageCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Compute Engine",
        productFamily: "Compute Instance",
        attributeFilters: [
          {
            key: "machineType",
            valueRegex: `^${this.machineType}$`,
          },
        ],
      },
      priceFilter: {
        purchaseOption: this.purchaseOption,
      },
    };
  }

  private createBootDiskCostQuery(): ProductQuery | undefined {
    if (!this.hasBootDisk) {
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
            valueRegex: this.getDiskTypeDescription(this.bootDiskType),
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private createScratchDiskCostQuery(): ProductQuery | undefined {
    if (this.scratchDisks <= 0) {
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
            valueRegex: this.getScratchDiskDescription(this.purchaseOption),
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private createGuestAcceleratorCostQueries(): ProductQuery[] {
    return this.guestAccelerators.map((accelerator) => ({
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Compute Engine",
        productFamily: "Compute",
        attributeFilters: [
          {
            key: "description",
            valueRegex: this.getGuestAcceleratorDescription(
              accelerator.type,
              this.purchaseOption,
            ),
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    }));
  }

  private getDiskTypeDescription(diskType: string): string {
    switch (diskType) {
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

  private getScratchDiskDescription(purchaseOption: string): string {
    if (purchaseOption.toLowerCase() === "preemptible") {
      return "/^SSD backed Local Storage attached to Spot Preemptible VMs/";
    }
    return "/^SSD backed Local Storage( in .*)?$/";
  }

  private getGuestAcceleratorDescription(
    guestAcceleratorType: string,
    purchaseOption: string,
  ): string {
    const parts = guestAcceleratorType.split("-");
    if (parts.length < 2) {
      return "";
    }

    const rest = this.toTitleCase(parts.slice(1).join(" "));

    const descPrefix = `${this.toTitleCase(parts[0])} ${rest} GPU`;

    if (purchaseOption.toLowerCase() === "preemptible") {
      return `/^${descPrefix} attached to Spot Preemptible VMs running/`;
    }
    return `/^${descPrefix} running/`;
  }

  private toTitleCase(str: string): string {
    return str.replace(/\w\S*/g, (txt) => {
      return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();
    });
  }
}
