import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class BigQueryTable implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class BigQueryTableQuery implements ResourceQuery<BigQueryTable> {
  private address: string;
  private datasetLocation: string;
  private monthlyStreamingInsertsMB?: number;
  private monthlyStorageWriteAPIGB?: number;
  private monthlyStorageReadAPITB?: number;
  private monthlyActiveStorageGB?: number;
  private monthlyLongTermStorageGB?: number;

  private activeStorageCostQuery: ProductQuery;
  private longTermStorageCostQuery: ProductQuery;
  private streamingInsertsCostQuery: ProductQuery;
  private storageWriteAPICostQuery?: ProductQuery;
  private storageReadAPICostQuery?: ProductQuery;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    const datasetIdSplit: string[] = resource.hclBlock.dataset_id?.split(".");
    let datasetIdJoined = datasetIdSplit.slice(0, -1).join(".");

    let dsLocation: string | undefined = undefined;
    for (const [key, value] of Object.entries(resource.hclBlock)) {
      if (key.includes(datasetIdJoined)) {
        dsLocation = value.location;
        break;
      }
    }
    if (!dsLocation) {
      // We couldn't determine the dataset location so we default to US.
      this.datasetLocation = "US";
    } else {
      this.datasetLocation = dsLocation;
    }
    this.address = name;
    this.monthlyStreamingInsertsMB =
      resource.hclBlock.monthly_streaming_inserts_mb;
    this.monthlyStorageWriteAPIGB =
      resource.hclBlock.monthly_storage_write_api_gb;
    this.monthlyStorageReadAPITB =
      resource.hclBlock.monthly_storage_read_api_tb;
    this.monthlyActiveStorageGB = resource.hclBlock.monthly_active_storage_gb;
    this.monthlyLongTermStorageGB =
      resource.hclBlock.monthly_long_term_storage_gb;

    this.activeStorageCostQuery = this.createActiveStorageCostQuery();
    this.longTermStorageCostQuery = this.createLongTermStorageCostQuery();
    this.streamingInsertsCostQuery = this.createStreamingInsertsCostQuery();
    this.storageWriteAPICostQuery = this.createStorageWriteAPICostQuery();
    this.storageReadAPICostQuery = this.createStorageReadAPICostQuery();
  }

  locationToRegion(): string {
    if (this.datasetLocation === "US") {
      return "us-east1";
    } else if (this.datasetLocation === "EU") {
      return "europe-west1";
    }
    return this.datasetLocation;
  }

  async fetchCosts(client: CostApiClient): Promise<BigQueryTable> {
    const costQueries: ProductQuery[] = [
      this.activeStorageCostQuery,
      this.longTermStorageCostQuery,
      this.streamingInsertsCostQuery,
    ];

    if (this.storageWriteAPICostQuery) {
      costQueries.push(this.storageWriteAPICostQuery);
    }

    if (this.storageReadAPICostQuery) {
      costQueries.push(this.storageReadAPICostQuery);
    }

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === this.activeStorageCostQuery) {
        const activeStorageCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Active storage",
          unit: activeStorageCost?.unit || "GB",
          defaultUnits: this.monthlyActiveStorageGB || 0,
          computeCost: (units: number) =>
            units <= 10.0
              ? 0
              : units * parseFloat(activeStorageCost?.usd || "0"),
        });
      } else if (result.query === this.longTermStorageCostQuery) {
        const longTermStorageCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Long-term storage",
          unit: longTermStorageCost?.unit || "GB",
          defaultUnits: this.monthlyLongTermStorageGB || 0,
          computeCost: (units: number) =>
            units <= 10.0
              ? 0
              : units * parseFloat(longTermStorageCost?.usd || "0"),
        });
      } else if (result.query === this.streamingInsertsCostQuery) {
        const streamingInsertsCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Streaming inserts",
          unit: streamingInsertsCost?.unit || "MB",
          defaultUnits: this.monthlyStreamingInsertsMB || 0,
          computeCost: (units: number) =>
            units * parseFloat(streamingInsertsCost?.usd || "0"),
        });
      } else if (result.query === this.storageWriteAPICostQuery) {
        const storageWriteAPICost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Storage write API",
          unit: storageWriteAPICost?.unit || "GB",
          defaultUnits: this.monthlyStorageWriteAPIGB || 0,
          computeCost: (units: number) =>
            units <= 2048
              ? 0
              : units * parseFloat(storageWriteAPICost?.usd || "0"),
        });
      } else if (result.query === this.storageReadAPICostQuery) {
        const storageReadAPICost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Storage read API",
          unit: storageReadAPICost?.unit || "TB",
          defaultUnits: this.monthlyStorageReadAPITB || 0,
          computeCost: (units: number) =>
            units * parseFloat(storageReadAPICost?.usd || "0"),
        });
      }
    });

    return new BigQueryTable(fixedCosts, dynamicCosts);
  }

  private createActiveStorageCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.locationToRegion(),
        service: "BigQuery",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: `Active Logical Storage (${this.locationToRegion()})`,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "10.0",
      },
    };
  }

  private createLongTermStorageCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.locationToRegion(),
        service: "BigQuery",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: `Long Term Logical Storage (${this.locationToRegion()})`,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "10.0",
      },
    };
  }

  private createStreamingInsertsCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.locationToRegion(),
        service: "BigQuery",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: `Streaming Insert (${this.locationToRegion()})`,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private createStorageWriteAPICostQuery(): ProductQuery | undefined {
    const region = this.mapRegion();
    if (!region) {
      return undefined;
    }

    return {
      productFilter: {
        vendorName: "gcp",
        region: region,
        service: "BigQuery Storage API",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: `BigQuery Storage API - Write (${region})`,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "2048",
      },
    };
  }

  private createStorageReadAPICostQuery(): ProductQuery | undefined {
    const region = this.mapRegion();
    if (!region) {
      return undefined;
    }

    return {
      productFilter: {
        vendorName: "gcp",
        region: region,
        service: "BigQuery Storage API",
        productFamily: "ApplicationServices",
        attributeFilters: [
          { key: "description", valueRegex: "BigQuery Storage API - Read" },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private mapRegion(): string {
    if (this.locationToRegion().toLowerCase().startsWith("us")) {
      return "us";
    }
    if (this.locationToRegion().toLowerCase().startsWith("europe")) {
      return "europe";
    }
    return "";
  }
}
