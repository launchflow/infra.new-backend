import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class ComputeAddress implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class ComputeAddressQuery implements ResourceQuery<ComputeAddress> {
  private address: string;
  private region: string;
  private addressType: string;
  private purpose: string;
  private instancePurchaseOption: string;

  private unusedVMComputeAddressQuery: ProductQuery;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.region = resource.hclBlock.region;
    this.addressType = resource.hclBlock.address_type;
    this.purpose = resource.hclBlock.purpose;
    this.instancePurchaseOption = resource.hclBlock.instance_purchase_option;

    this.unusedVMComputeAddressQuery = this.createUnusedVMComputeAddressQuery();
  }

  async fetchCosts(client: CostApiClient): Promise<ComputeAddress> {
    const costQueries: ProductQuery[] = [];

    costQueries.push(this.unusedVMComputeAddressQuery);

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === this.unusedVMComputeAddressQuery) {
        const unusedVMComputeAddressCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "IP address (unused)",
          unit: unusedVMComputeAddressCost?.unit || "hours",
          defaultUnits: 0,
          computeCost: (units: number) =>
            units * parseFloat(unusedVMComputeAddressCost?.usd || "0"),
        });
      }
    });

    return new ComputeAddress(fixedCosts, dynamicCosts);
  }

  private createUnusedVMComputeAddressQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Compute Engine",
        productFamily: "Network",
        attributeFilters: [
          {
            key: "description",
            valueRegex: "^Static Ip Charge.*",
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "1.0",
      },
    };
  }
}
