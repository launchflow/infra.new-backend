import { InfraNewCostApiClient } from "./api/remote";
import { Parser } from "./parsers/hcl_parser_v2";
import { tofuRegistry } from "./resources/registry";
import { Module, Resource } from "./terraform/schema";

import * as yargs from "yargs";

const argv = yargs
  .option("directory", {
    alias: "d",
    description: "The directory to parse",
    type: "string",
    demandOption: true,
  })
  .help()
  .alias("help", "h").argv;

// @ts-expect-error ignoring
const parser = new Parser(argv.directory, {
  tfVarsPaths: [],
  workspaceName: "",
});

function getResourcesFromModule(module: Module): Resource[] {
  const resources: Resource[] = [];
  for (const block of module.childResources) {
    resources.push(block);
  }
  for (const childModule of module.childModules) {
    resources.push(...getResourcesFromModule(childModule));
  }
  return resources;
}

const apiClient = new InfraNewCostApiClient();
parser
  .parseDirectory()
  .then((result) => {
    result.evaluate();
    const resources = getResourcesFromModule(result);
    const resourceMap: { [key: string]: Resource } = {};
    for (const hclResource of resources) {
      resourceMap[hclResource.identifier] = hclResource;
    }
    for (const hclResource of resources) {
      const resourceQueryType = tofuRegistry[hclResource.resourceType];
      if (resourceQueryType) {
        const resourceQuery = new resourceQueryType(
          hclResource.name,
          hclResource,
          resourceMap,
        );
        resourceQuery.fetchCosts(apiClient).then((resource) => {
          console.log(
            `Resource: ${hclResource.resourceType}.${hclResource.name}`,
          );
          console.log("   Fixed costs:");
          for (const fixedCost of resource.fixedCosts) {
            console.log(`      ${fixedCost.name}: ${fixedCost.monthlyCost}`);
          }
          console.log("   Dynamic costs:");
          for (const dynamicCost of resource.dynamicCosts) {
            console.log(
              `      ${dynamicCost.name}: ${dynamicCost.computeCost(dynamicCost.defaultUnits)}`,
            );
          }
        });
      } else {
        console.error(
          `Resource type ${hclResource.resourceType} not found in registry`,
        );
      }
    }
  })
  .catch((error) => console.error("Parsing failed:", error));
