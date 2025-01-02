import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";
import { CostApiClient, ProductQuery } from "../../api/client";

class GCSStorageBucket implements Resource {
  public fixedCosts: FixedCost[] = [];
  public dynamicCosts: DynamicCost[] = [];

  constructor(
    public name: string,
    public location: string,
    public storageClass: string,
    public storageCostUsd: number,
  ) {
    this.dynamicCosts.push({
      unit: "GB",
      name: "Storage",
      defaultUnits: 0,
      computeCost: (units: number) => units * this.storageCostUsd,
    });
  }
}

export class GCSStorageBucketQuery implements ResourceQuery<GCSStorageBucket> {
  private location: string;
  private storageClass: string;
  private name: string;
  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.name = name;
    // @ts-ignore
    this.location = resource.hclBlock.location;
    // @ts-ignore
    this.storageClass = resource.hclBlock.storage_class || "STANDARD";
  }

  async fetchCosts(client: CostApiClient): Promise<GCSStorageBucket> {
    const [region, resourceGroup] = getDSRegionResourceGroup(
      this.location,
      this.storageClass,
    );
    // There are three components to the cost of a GCS bucket
    // 1. Storage cost
    // 2. Operations cost
    // 3. Retrieval cost
    // For now we just implement the storage cost
    const storageCostQuery: ProductQuery = {
      productFilter: {
        vendorName: "gcp",
        service: "Cloud Storage",
        region: region,
        attributeFilters: [
          { key: "resource_group", value: resourceGroup },
          { key: "description", valueRegex: "/^(?!.*?\\(Early Delete\\))/" },
        ],
      },
    };
    return client.fetchProducts([storageCostQuery]).then((results) => {
      const storageCost =
        results[0].products[0].prices && results[0].products[0].prices[0].usd;
      const parsedStorageCost = parseFloat(storageCost || "0");

      return new GCSStorageBucket(
        this.name,
        this.location,
        this.storageClass,
        parsedStorageCost,
      );
    });
  }
}

function getDSRegionResourceGroup(
  location: string,
  storageClass: string,
): [string, string] {
  let region: string = location.toLowerCase();
  let resourceGroup: string;

  switch (storageClass.toLowerCase()) {
    case "nearline":
      resourceGroup = "NearlineStorage";
      break;
    case "coldline":
      resourceGroup = "ColdlineStorage";
      break;
    case "archive":
      resourceGroup = "ArchiveStorage";
      break;
    default:
      resourceGroup = "RegionalStorage";
  }

  if (resourceGroup.toLowerCase() === "regionalstorage") {
    switch (region) {
      case "asia":
      case "eu":
      case "us":
      case "asia1":
      case "eur4":
      case "nam4":
        resourceGroup = "MultiRegionalStorage";
        break;
    }
  }

  if (
    region === "eu" &&
    resourceGroup.toLowerCase() === "multiregionalstorage"
  ) {
    region = "europe";
  }

  return [region, resourceGroup];
}
