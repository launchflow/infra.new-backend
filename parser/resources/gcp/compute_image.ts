import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class ComputeImage implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class ComputeImageQuery implements ResourceQuery<ComputeImage> {
  private address: string;
  private region: string;
  private storageSize: number;
  private storageGB?: number;

  private storageImageCostQuery: ProductQuery;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.region = resource.hclBlock.region || "us-central1";
    this.storageSize = resource.hclBlock.storage_size || 0;
    this.storageGB = resource.hclBlock.storage_gb;

    this.storageImageCostQuery = this.createStorageImageCostQuery();
  }

  async fetchCosts(client: CostApiClient): Promise<ComputeImage> {
    const costQueries: ProductQuery[] = [this.storageImageCostQuery];

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === this.storageImageCostQuery) {
        const storageImageCost =
          result.products[0].prices && result.products[0].prices[0];
        console.log(storageImageCost);
        dynamicCosts.push({
          name: "Storage",
          unit: storageImageCost?.unit || "GB",
          defaultUnits: this.storageGB || this.storageSize,
          computeCost: (units: number) =>
            units * parseFloat(storageImageCost?.usd || "0"),
        });
      }
    });

    return new ComputeImage(fixedCosts, dynamicCosts);
  }

  private createStorageImageCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Compute Engine",
        productFamily: "Storage",
        attributeFilters: [
          {
            key: "description",
            valueRegex: "Storage Image",
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }
}
