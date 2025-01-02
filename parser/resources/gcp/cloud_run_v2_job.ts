import { CostApiClient, ProductQuery } from "../../api/client";
import { Resource as HCLResource } from "../../terraform/schema";
import { DynamicCost, FixedCost, Resource, ResourceQuery } from "../resource";

class CloudRunV2Job implements Resource {
  public fixedCosts: FixedCost[];
  public dynamicCosts: DynamicCost[];

  constructor(fixedCosts: FixedCost[], dynamicCosts: DynamicCost[]) {
    this.fixedCosts = fixedCosts;
    this.dynamicCosts = dynamicCosts;
  }
}

export class CloudRunV2JobQuery implements ResourceQuery<CloudRunV2Job> {
  private address: string;
  private region: string;
  private cpuLimit: number;
  private memoryLimit: number;
  private taskCount: number;
  private monthlyJobExecutions?: number;
  private avgTaskExecutionMins?: number;

  private cpuCostQuery: ProductQuery;
  private memoryCostQuery: ProductQuery;

  constructor(
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ) {
    this.address = name;
    this.region = resource.hclBlock.location;
    this.cpuLimit = resource.hclBlock.cpu_limit;
    this.memoryLimit = resource.hclBlock.memory_limit;
    this.taskCount = resource.hclBlock.task_count;
    this.monthlyJobExecutions = resource.hclBlock.monthly_job_executions;
    this.avgTaskExecutionMins = resource.hclBlock.average_task_execution_mins;

    this.cpuCostQuery = this.createCpuCostQuery();
    this.memoryCostQuery = this.createMemoryCostQuery();
  }

  async fetchCosts(client: CostApiClient): Promise<CloudRunV2Job> {
    const costQueries: ProductQuery[] = [
      this.cpuCostQuery,
      this.memoryCostQuery,
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
      }
    });

    return new CloudRunV2Job(fixedCosts, dynamicCosts);
  }

  private createCpuCostQuery(): ProductQuery {
    return {
      productFilter: {
        vendorName: "gcp",
        region: this.region,
        service: "Cloud Run",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: `CPU Allocation Time (Jobs) in ${this.region}`,
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
        service: "Cloud Run",
        productFamily: "ApplicationServices",
        attributeFilters: [
          {
            key: "description",
            value: `Memory Allocation Time (Jobs) in ${this.region}`,
          },
        ],
      },
      priceFilter: {
        startUsageAmount: "0.0",
      },
    };
  }

  private calculateCpuSeconds(): number | undefined {
    if (
      this.avgTaskExecutionMins === undefined ||
      this.monthlyJobExecutions === undefined
    ) {
      return undefined;
    }

    const seconds = this.avgTaskExecutionMins * 60;
    return this.monthlyJobExecutions * this.taskCount * seconds * this.cpuLimit;
  }

  private calculateGBSeconds(): number | undefined {
    if (
      this.avgTaskExecutionMins === undefined ||
      this.monthlyJobExecutions === undefined
    ) {
      return undefined;
    }

    const seconds = this.avgTaskExecutionMins * 60;
    const gb = this.memoryLimit / (1024 * 1024 * 1024);
    return this.monthlyJobExecutions * this.taskCount * seconds * gb;
  }
}
