import { CostApiClient } from "../api/client";
import { Resource as HCLResource } from "../terraform/schema";

export interface DynamicCost {
  unit: string;
  name: string;

  // The default number of units
  defaultUnits: number;

  computeCost(units: number): number;
}

export interface FixedCost {
  name: string;
  quantity: number;
  usd: number;
  unit: string;
  monthlyCost: number;
}

export interface Resource {
  fixedCosts: FixedCost[];
  dynamicCosts: DynamicCost[];
}

export interface ResourceQuery<T extends Resource> {
  fetchCosts(client: CostApiClient): Promise<T>;
}

export interface ResourceQueryFactory<T extends Resource> {
  new (
    name: string,
    resource: HCLResource,
    allResources: Record<string, HCLResource>,
  ): ResourceQuery<T>;
}
