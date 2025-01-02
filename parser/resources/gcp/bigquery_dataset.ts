import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class BigQueryDataset implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class BigQueryDatasetQuery implements ResourceQuery<BigQueryDataset> {
  private address: string;
  private location: string;
  private monthlyQueriesTB?: number;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.location = resource.hclBlock.location;
    this.monthlyQueriesTB = resource.hclBlock.monthly_queries_tb;
  }

  locationToRegion(): string {
    if (this.location === "US") {
      return "us-east1";
    } else if (this.location === "EU") {
      return "europe-west1";
    }
    return this.location;
  }

  async fetchCosts(client: CostApiClient): Promise<BigQueryDataset> {
    const queryCostQuery = this.queryCostQuery();
    const costQueries: ProductQuery[] = [queryCostQuery];

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === queryCostQuery) {
        const queryCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Queries (on-demand)",
          unit: queryCost?.unit || "TB",
          defaultUnits: this.monthlyQueriesTB || 0,
          computeCost: (units: number) =>
            units <= 1 ? 0 : units * parseFloat(queryCost?.usd || "0"),
        });
      }
    });

    return new BigQueryDataset(fixedCosts, dynamicCosts);
  }

  private queryCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.locationToRegion(),
        service: "BigQuery",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: `Analysis (${this.locationToRegion()})`,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "1.0",
      },
    };
  }
}
