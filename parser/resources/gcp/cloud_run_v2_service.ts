import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class CloudRunService implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

const ASIAN_TIER_1_REGIONS = new Set([
  "asia-east1",
  "asia-northeast1",
  "asia-northeast2",
  "asia-south1",
]);

export class CloudRunServiceQuery implements ResourceQuery<CloudRunService> {
  private address: string;
  private region: string;
  private cpuLimit: number;
  private isThrottlingEnabled: boolean;
  private memoryLimit: number;
  private minInstanceCount: number;
  private monthlyRequests?: number;
  private averageRequestDurationMs?: number;
  private concurrentRequestsPerInstance?: number;
  private instanceHrs?: number;

  private cpuCostQuery: ProductQuery;
  private memoryCostQuery: ProductQuery;
  private requestCostQuery: ProductQuery;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.region = resource.hclBlock.location;
    this.cpuLimit = resource.hclBlock.cpu_limit;
    this.isThrottlingEnabled = resource.hclBlock.is_throttling_enabled;
    this.memoryLimit = resource.hclBlock.memory_limit;
    this.minInstanceCount = resource.hclBlock.min_instance_count;
    this.monthlyRequests = resource.hclBlock.monthly_requests;
    this.averageRequestDurationMs =
      resource.hclBlock.average_request_duration_ms;
    this.concurrentRequestsPerInstance =
      resource.hclBlock.concurrent_requests_per_instance;
    this.instanceHrs = resource.hclBlock.instance_hrs;

    const regionTier = this.getRegionTier(this.region);
    const cpuDesc =
      regionTier === "Tier 2"
        ? "CPU Allocation Time (tier 2)"
        : "CPU Allocation Time";
    const memoryDesc =
      regionTier === "Tier 2"
        ? "Memory Allocation Time (tier 2)"
        : "Memory Allocation Time";

    this.cpuCostQuery = this.createCpuCostQuery(cpuDesc);
    this.memoryCostQuery = this.createMemoryCostQuery(memoryDesc);
    this.requestCostQuery = this.createRequestCostQuery();
  }

  async fetchCosts(client: CostApiClient): Promise<CloudRunService> {
    const costQueries: ProductQuery[] = [
      this.cpuCostQuery,
      this.memoryCostQuery,
      this.requestCostQuery,
    ];

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === this.cpuCostQuery) {
        const cpuCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "CPU allocation time",
          unit: cpuCost?.unit || "vCPU-seconds",
          defaultUnits: this.calculateCpuSeconds() || 0,
          computeCost: (units: number) =>
            units * parseFloat(cpuCost?.usd || "0"),
        });
      } else if (result.query === this.memoryCostQuery) {
        const memoryCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Memory allocation time",
          unit: memoryCost?.unit || "GiB-seconds",
          defaultUnits: this.calculateGBSeconds() || 0,
          computeCost: (units: number) =>
            units * parseFloat(memoryCost?.usd || "0"),
        });
      } else if (result.query === this.requestCostQuery) {
        const requestCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Number of requests",
          unit: requestCost?.unit || "requests",
          defaultUnits: this.monthlyRequests || 0,
          computeCost: (units: number) =>
            units <= 2000000 ? 0 : units * parseFloat(requestCost?.usd || "0"),
        });
      }
    });

    return new CloudRunService(fixedCosts, dynamicCosts);
  }

  private createCpuCostQuery(cpuDesc: string): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Cloud Run",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: cpuDesc,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private createMemoryCostQuery(memoryDesc: string): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Cloud Run",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: memoryDesc,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private createRequestCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: "global",
        service: "Cloud Run",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: "Requests",
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "2000000.0",
      },
    };
  }

  private getRegionTier(region: string): "Tier 1" | "Tier 2" {
    if (
      region.startsWith("us") ||
      region.startsWith("europe") ||
      ASIAN_TIER_1_REGIONS.has(region)
    ) {
      return "Tier 1";
    }
    return "Tier 2";
  }

  private calculateCpuSeconds(): number | undefined {
    if (this.isThrottlingEnabled) {
      if (
        this.averageRequestDurationMs === undefined ||
        this.monthlyRequests === undefined ||
        this.concurrentRequestsPerInstance === undefined
      ) {
        return undefined;
      }

      const requestDurationInSeconds = this.averageRequestDurationMs / 1000;
      return (
        ((this.monthlyRequests * requestDurationInSeconds) /
          this.concurrentRequestsPerInstance) *
        this.cpuLimit
      );
    }

    if (this.instanceHrs !== undefined && this.instanceHrs > 0) {
      return this.instanceHrs * 60 * 60 * this.cpuLimit * this.minInstanceCount;
    }

    return this.minInstanceCount * (730 * 60 * 60) * this.cpuLimit;
  }

  private calculateGBSeconds(): number | undefined {
    const gb = this.memoryLimit / (1024 * 1024 * 1024);
    if (this.isThrottlingEnabled) {
      if (
        this.averageRequestDurationMs === undefined ||
        this.monthlyRequests === undefined ||
        this.concurrentRequestsPerInstance === undefined
      ) {
        return undefined;
      }

      const requestDurationInSeconds = this.averageRequestDurationMs / 1000;
      return (
        ((this.monthlyRequests * requestDurationInSeconds) /
          this.concurrentRequestsPerInstance) *
        gb
      );
    }

    if (this.instanceHrs !== undefined && this.instanceHrs > 0) {
      return this.instanceHrs * 60 * 60 * gb * this.minInstanceCount;
    }

    return this.minInstanceCount * (730 * 60 * 60) * gb;
  }
}
