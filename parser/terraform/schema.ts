import { evaluate } from "mathjs";

export class Module {
  name: string;
  identifier: string;
  hclBlock: {
    [key: string]: any;
  };
  inputs: Record<string, any> = {};
  variables: Record<string, any> = {};
  childResources: Resource[] = [];
  childModules: Module[] = [];

  constructor(
    name: string,
    identifier: string,
    hclBlock: {
      [key: string]: any;
    },
  ) {
    this.name = name;
    this.identifier = identifier;
    this.hclBlock = hclBlock;
  }

  evaluate(): void {
    const variables = JSON.parse(JSON.stringify(this.variables));
    for (const [key, value] of Object.entries(this.inputs)) {
      variables[key] = value;
    }
    for (const key in variables) {
      if (variables[key] === undefined) {
        throw new Error(`Variable '${key}' is undefined`);
      }
    }
    for (const [key, value] of Object.entries(this.hclBlock)) {
      if (typeof value === "string") {
        this.hclBlock[key] = replaceVariables(value, this.variables);
      } else if (typeof value === "object" && value !== null) {
        this.hclBlock[key] = replaceVariablesRecursive(value, this.variables);
      }
    }
    // Then evaluates the child resources and modules
    for (const resource of this.childResources) {
      resource.evaluate(variables);
    }
    for (const module of this.childModules) {
      module.evaluate();
    }
  }
}

export class Resource {
  name: string;
  identifier: string;
  hclBlock: {
    [key: string]: any;
  };
  resourceType: string;

  constructor(
    name: string,
    identifier: string,
    hclBlock: {
      [key: string]: any;
    },
    resourceType: string,
  ) {
    this.name = name;
    this.identifier = identifier;
    this.hclBlock = hclBlock;
    this.resourceType = resourceType;
  }

  evaluate(variables: Record<string, any>): void {
    for (const [key, value] of Object.entries(this.hclBlock)) {
      if (typeof value === "string") {
        this.hclBlock[key] = replaceVariables(value, variables);
      } else if (typeof value === "object" && value !== null) {
        this.hclBlock[key] = replaceVariablesRecursive(value, variables);
      }
    }
  }
}

function replaceVariables(
  value: string,
  variables: Record<string, any>,
): string | number {
  const replacedValue = value.replace(/\$\{([^}]+)\}/g, (_, expression) => {
    const exprWithVars = expression.replace(
      /var\.([a-zA-Z_]\w*)/g,
      (_: any, varName: string) => {
        return variables[varName];
      },
    );
    try {
      return evaluate(exprWithVars);
    } catch (error) {
      return exprWithVars;
    }
  });

  return replacedValue;
}

function replaceVariablesRecursive(
  obj: any,
  variables: Record<string, any>,
): any {
  if (typeof obj === "string") {
    return replaceVariables(obj, variables);
  } else if (Array.isArray(obj)) {
    return obj.map((item) => replaceVariablesRecursive(item, variables));
  } else if (typeof obj === "object" && obj !== null) {
    const result: { [key: string]: any } = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceVariablesRecursive(value, variables);
    }
    return result;
  }
  return obj;
}
