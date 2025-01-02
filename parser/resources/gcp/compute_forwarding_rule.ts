import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class ComputeForwardingRule implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class ComputeForwardingRuleQuery
  implements ResourceQuery<ComputeForwardingRule>
{
  private address: string;
  private region: string;

  private forwardingCostQuery: ProductQuery;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.region = resource.hclBlock.region;

    this.forwardingCostQuery = this.createForwardingCostQuery();
  }

  async fetchCosts(client: CostApiClient): Promise<ComputeForwardingRule> {
    const costQueries: ProductQuery[] = [this.forwardingCostQuery];

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === this.forwardingCostQuery) {
        const forwardingCost =
          result.products[0].prices && result.products[0].prices[0];
        fixedCosts.push({
          name: "Forwarding rules",
          unit: forwardingCost?.unit || "hours",
          usd: parseFloat(forwardingCost?.usd || "0"),
          monthlyCost: parseFloat(forwardingCost?.usd || "0") * 24 * 30,
          quantity: 24 * 30,
        });
      }
    });

    return new ComputeForwardingRule(fixedCosts, dynamicCosts);
  }

  private createForwardingCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Networking",
        productFamily: "Network",
        attributeFilters: [
          {
            key: "description",
            valueRegex: "/^Cloud Load Balancer Forwarding Rule Minimum/i",
          },
        ],
      },
      priceFilter: {
        purchaseOption: "OnDemand",
      },
    };
  }
}
