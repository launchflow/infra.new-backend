import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class CloudFunctionsFunction implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class CloudFunctionsFunctionQuery
  implements ResourceQuery<CloudFunctionsFunction>
{
  private address: string;
  private region: string;
  private availableMemoryMB?: number;
  private requestDurationMs?: number;
  private monthlyFunctionInvocations?: number;
  private monthlyOutboundDataGB?: number;

  private cpuCostQuery: ProductQuery;
  private memoryCostQuery: ProductQuery;
  private invocationsCostQuery: ProductQuery;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.region = resource.hclBlock.region || "us-central1";
    this.availableMemoryMB = resource.hclBlock.available_memory_mb;
    this.requestDurationMs = resource.hclBlock.request_duration_ms;
    this.monthlyFunctionInvocations =
      resource.hclBlock.monthly_function_invocations;
    this.monthlyOutboundDataGB = resource.hclBlock.monthly_outbound_data_gb;

    this.cpuCostQuery = this.createCpuCostQuery();
    this.memoryCostQuery = this.createMemoryCostQuery();
    this.invocationsCostQuery = this.createInvocationsCostQuery();
  }

  async fetchCosts(client: CostApiClient): Promise<CloudFunctionsFunction> {
    const costQueries: ProductQuery[] = [
      this.cpuCostQuery,
      this.memoryCostQuery,
      this.invocationsCostQuery,
    ];

    const fixedCosts: FixedCost[] = [];
    const dynamicCosts: DynamicCost[] = [];
    const results = await client.fetchProducts(costQueries);

    results.forEach((result) => {
      if (result.query === this.cpuCostQuery) {
        const cpuCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "CPU",
          unit: cpuCost?.unit || "GHz-seconds",
          defaultUnits: this.calculateGHzSeconds(),
          computeCost: (units: number) =>
            units * parseFloat(cpuCost?.usd || "0"),
        });
      } else if (result.query === this.memoryCostQuery) {
        const memoryCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Memory",
          unit: memoryCost?.unit || "GB-seconds",
          defaultUnits: this.calculateGBSeconds(),
          computeCost: (units: number) =>
            units * parseFloat(memoryCost?.usd || "0"),
        });
      } else if (result.query === this.invocationsCostQuery) {
        const invocationsCost =
          result.products[0].prices && result.products[0].prices[0];
        dynamicCosts.push({
          name: "Invocations",
          unit: invocationsCost?.unit || "invocations",
          defaultUnits: this.monthlyFunctionInvocations || 0,
          computeCost: (units: number) =>
            units <= 2000000
              ? 0
              : units * parseFloat(invocationsCost?.usd || "0"),
        });
      }
    });

    return new CloudFunctionsFunction(fixedCosts, dynamicCosts);
  }

  private createCpuCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Cloud Run Functions",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            valueRegex: "\\(1st Gen\\) CPU Time",
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private createMemoryCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Cloud Run Functions",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            valueRegex: "\\(1st Gen\\) Memory Time",
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private createInvocationsCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: "global",
        service: "Cloud Run Functions",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            valueRegex: "\\(1st Gen\\) Invocations",
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "2000000.0",
      },
    };
  }

  private calculateGBSeconds(): number {
    const memorySize = this.availableMemoryMB || 256;
    const requestDuration = this.requestDurationMs || 100;
    const monthlyRequests = this.monthlyFunctionInvocations || 0;

    const gb = memorySize / 1024;
    const seconds = requestDuration / 1000;
    return monthlyRequests * gb * seconds;
  }

  private calculateGHzSeconds(): number {
    const memorySize = this.availableMemoryMB || 256;
    const requestDuration = this.requestDurationMs || 100;
    const monthlyRequests = this.monthlyFunctionInvocations || 0;

    const gb = memorySize / 1000;
    const seconds = requestDuration / 1000;
    return monthlyRequests * gb * seconds;
  }
}
