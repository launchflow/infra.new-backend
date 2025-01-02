import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class SQLDatabaseInstance implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

const lightweightRAM = 3840;
const standardRAMRatio = 3840;
const highmemRAMRatio = 6656;

export class SQLDatabaseInstanceQuery
  implements ResourceQuery<SQLDatabaseInstance>
{
  // TODO: investigate replicas
  private availabilityType: string;
  private name: string;
  private diskType: string;
  private diskSize: number;
  private publicIP: boolean;
  private region: string;
  private dbType: "MySQL" | "PostgreSQL" | "SQL Server";
  private tier: string;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    const settings = resource.hclBlock.settings
      ? resource.hclBlock.settings[0]
      : undefined;
    const ipConfiguration = settings?.ip_configuration
      ? settings?.ip_configuration[0]
      : undefined;
    this.name = name;
    this.availabilityType = resource.hclBlock.availability_type || "ZONAL";
    this.diskType = settings?.disk_type || "PD_SSD";
    this.diskSize = settings?.disk_size || 10;
    this.publicIP = ipConfiguration?.ipv4_enabled || false;
    this.region = resource.hclBlock.region;
    // TODO: validate that this is the correct default tier
    this.tier = settings?.tier || "db-f1-micro";
    const db_version: string = resource.hclBlock.database_version.toLowerCase();
    if (db_version.startsWith("mysql")) {
      this.dbType = "MySQL";
    } else if (db_version.startsWith("postgres")) {
      this.dbType = "PostgreSQL";
    } else if (db_version.startsWith("sqlserver")) {
      this.dbType = "SQL Server";
    } else {
      this.dbType = "MySQL";
    }
  }

  async fetchCosts(client: CostApiClient): Promise<SQLDatabaseInstance> {
    const storageCostQuery = this.storageCostQuery();
    let publicIPCostQuery: ProductQuery | undefined = undefined;
    let sharedInstanceCostQuery: ProductQuery | undefined = undefined;
    let memQuery: ProductQuery | undefined = undefined;
    let cpuQuery: ProductQuery | undefined = undefined;
    const costQueries = [storageCostQuery];

    if (this.publicIP) {
      publicIPCostQuery = this.publicIPCostQuery();
      costQueries.push(publicIPCostQuery);
    }

    if (this.isShared()) {
      sharedInstanceCostQuery = this.sharedInstanceCostComponent();
      if (sharedInstanceCostQuery) {
        costQueries.push(sharedInstanceCostQuery);
      }
    } else {
      const queries = this.instanceCostQueries();
      memQuery = queries.memQuery;
      cpuQuery = queries.cpuQuery;
      costQueries.push(memQuery, cpuQuery);
    }

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === storageCostQuery) {
        const storageCost =
          result.products[0].prices && result.products[0].prices[0];
        fixedCosts.push({
          name: `Monthly ${this.diskType.replace("PD_", "")} storage cost`,
          quantity: this.diskSize,
          usd: parseFloat(storageCost?.usd || "0"),
          unit: storageCost?.unit || "gigabyte month",
          monthlyCost: this.diskSize * parseFloat(storageCost?.usd || "0"),
        });
      } else if (result.query === publicIPCostQuery) {
        const publicIPCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Idle Public IP address cost",
          unit: publicIPCost?.unit || "hour",
          defaultUnits: 0,
          computeCost: (units: number) =>
            units * parseFloat(publicIPCost?.usd || "0"),
        });
      } else if (result.query === memQuery) {
        const memoryCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Memory cost",
          unit: memoryCost?.unit || "hour",
          defaultUnits: 730,
          computeCost: (units: number) =>
            units * parseFloat(memoryCost?.usd || "0"),
        });
      } else if (result.query === cpuQuery) {
        const cpuCost =
          result.products[0].prices && result.products[0].prices[0];
        const vCPUs = this.vCPUs();
        dynamicCosts.push({
          name: "vCPU cost",
          defaultUnits: 730,
          unit: cpuCost?.unit || "hour",
          computeCost: (units: number) =>
            units * parseFloat(cpuCost?.usd || "0") * vCPUs,
        });
      } else if (result.query === sharedInstanceCostQuery) {
        const sharedCost =
          result.products[0].prices && result.products[0].prices[0];
        const mem = this.memory();
        dynamicCosts.push({
          name: "Shared instance vCPU cost",
          unit: sharedCost?.unit || "hour",
          defaultUnits: 730,
          computeCost: (units: number) =>
            units * parseFloat(sharedCost?.usd || "0") * mem,
        });
      }
    });
    return new SQLDatabaseInstance(fixedCosts, dynamicCosts);
  }

  private availabilityTypeFormatted(): string {
    return (
      this.availabilityType.toLowerCase().charAt(0).toUpperCase() +
      this.availabilityType.toLowerCase().slice(1)
    );
  }

  private storageCostQuery(): ProductQuery {
    const diskTypeDisplayName =
      this.diskType === "PD_SSD" ? "Standard storage" : "Low cost storage";
    const description = `${this.dbType}: ${this.availabilityTypeFormatted()} - ${diskTypeDisplayName}`;
    return {
      productFilter: {
        vendorName: "gcp",
        service: "Cloud SQL",
        region: this.region,
        attributeFilters: [
          {
            key: "resource_group",
            value:
              this.diskType == "PD_SSD" || this.dbType === "MySQL"
                ? "SSD"
                : "PDStandard",
          },
          { key: "description", valueRegex: description },
        ],
      },
    };
  }

  private publicIPCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        service: "Cloud SQL",
        region: "global",
        attributeFilters: [
          { key: "resource_group", value: "IpAddress" },
          { key: "description", valueRegex: "/IP address idling - hour/" },
        ],
      },
    };
  }

  private isShared(): boolean {
    return (
      this.tier.toLowerCase() === "db-f1-micro" ||
      this.tier.toLowerCase() === "db-g1-small"
    );
  }

  private sharedInstanceCostComponent(): ProductQuery | undefined {
    let resourceGroup: string;
    if (this.tier.toLowerCase() === "db-f1-micro") {
      resourceGroup = "SQLGen2InstancesF1Micro";
    } else if (this.tier.toLowerCase() === "db-g1-small") {
      resourceGroup = "SQLGen2InstancesG1Small";
    } else {
      console.warn(`tier ${this.tier} of ${this.name} is not supported`);
      return undefined;
    }

    const descriptionRegex = `Cloud SQL for ${this.dbType}: ${this.availabilityTypeFormatted()}`;

    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Cloud SQL",
        attributeFilters: [
          { key: "resource_group", value: resourceGroup },
          { key: "description", valueRegex: descriptionRegex },
        ],
      },
    };
  }

  private instanceCostQueries(): {
    memQuery: ProductQuery;
    cpuQuery: ProductQuery;
  } {
    const cpuDescRegex = `${this.dbType}: ${this.availabilityTypeFormatted()} - vCPU`;
    const memDescRegex = `${this.dbType}: ${this.availabilityTypeFormatted()} - RAM`;

    const memQuery: ProductQuery = {
      productFilter: {
        vendorName: "gcp",
        service: "Cloud SQL",
        region: this.region,
        productFamily: "ApplicationServices",
        attributeFilters: [{ key: "description", valueRegex: memDescRegex }],
      },
    };

    const cpuQuery: ProductQuery = {
      productFilter: {
        vendorName: "gcp",
        service: "Cloud SQL",
        region: this.region,
        productFamily: "ApplicationServices",
        attributeFilters: [{ key: "description", valueRegex: cpuDescRegex }],
      },
    };

    return { memQuery, cpuQuery };
  }

  private vCPUs(): number {
    const p = this.tier.split("-");

    if (p.length < 3) {
      throw new Error(`tier ${this.tier} has no vCPU data`);
    }

    if (this.isCustom()) {
      return parseInt(p[2]);
    }

    return parseInt(p[p.length - 1]);
  }

  private memory(): number {
    if (this.isCustom()) {
      const p = this.tier.split("-");

      if (p.length < 4) {
        throw new Error(`tier ${this.tier} has no RAM data`);
      }

      const v = parseFloat(p[p.length - 1]);
      if (isNaN(v)) {
        throw new Error(`Invalid RAM value in tier ${this.tier}`);
      }

      return v / 1024;
    } else if (this.isStandard() || this.isHighMem()) {
      const vCPUs = this.vCPUs();

      if (this.isStandard()) {
        return (vCPUs * standardRAMRatio) / 1024;
      } else if (this.isHighMem()) {
        return (vCPUs * highmemRAMRatio) / 1024;
      }
    } else if (this.isLightweight()) {
      return lightweightRAM / 1024;
    }

    throw new Error(`tier ${this.tier} has no RAM data`);
  }

  private isCustom(): boolean {
    return this.tier.toLowerCase().startsWith("db-custom-");
  }

  private isStandard(): boolean {
    return this.tier.toLowerCase().startsWith("db-n1-standard-");
  }

  private isHighMem(): boolean {
    return this.tier.toLowerCase().startsWith("db-n1-highmem-");
  }

  private isLightweight(): boolean {
    return (
      this.tier.toLowerCase() === "db-f1-micro" ||
      this.tier.toLowerCase() === "db-g1-small"
    );
  }
}
