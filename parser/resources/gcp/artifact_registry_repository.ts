import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

const artifactRegSvcName = "Artifact Registry";

class ArtifactRegistryRepository implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class ArtifactRegistryRepositoryQuery
  implements ResourceQuery<ArtifactRegistryRepository>
{
  private address: string;
  private location: string;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.location = resource.hclBlock.location;
  }

  async fetchCosts(client: CostApiClient): Promise<ArtifactRegistryRepository> {
    const storageCostQuery = this.storageCostQuery();
    const costQueries: ProductQuery[] = [storageCostQuery];

    // TODO: add egress cost

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === storageCostQuery) {
        const storageCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Storage",
          unit: storageCost?.unit || "GB",
          defaultUnits: 0,
          computeCost: (units: number) =>
            units <= 0.5 ? 0 : units * parseFloat(storageCost?.usd || "0"),
        });
      }
    });

    return new ArtifactRegistryRepository(fixedCosts, dynamicCosts);
  }

  private storageCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        service: artifactRegSvcName,
        productFamily: "ApplicationServices",
        attributeFilters: [
          { key: "description", value: "Artifact Registry Storage" },
          { key: "resource_group", value: "Storage" },
        ],
      },
      priceFilter: {
        purchaseOption: "OnDemand",
        startUsageAmount: "0.5",
      },
    };
  }
}
