import * as fs from "fs";
import * as path from "path";
import * as hcl from "hcl2-parser";
import { Block } from "../terraform/schema";

interface ParserOptions {
  tfVarsPaths?: string[];
  inputVars?: { [key: string]: any };
  workspaceName?: string;
  // Add other options as needed
}

export class Parser {
  private startingPath: string;
  private detectedProjectPath: string;
  private projectName: string;
  private tfEnvVars: Map<string, any>;
  private tfvarsPaths: string[];
  private inputVars: Map<string, any>;
  private workspaceName: string;
  private envName: string;
  // Add other properties as needed

  constructor(projectRoot: string, options: ParserOptions = {}) {
    this.startingPath = projectRoot;
    this.detectedProjectPath = projectRoot;
    this.projectName = "";
    this.tfEnvVars = new Map();
    this.tfvarsPaths = options.tfVarsPaths || [];
    this.inputVars = new Map(Object.entries(options.inputVars || {}));
    this.workspaceName = options.workspaceName || "";
    this.envName = "";
    // Initialize other properties
  }

  async parseDirectory(): Promise<Block[]> {
    try {
      const files = await this.loadDirectory(this.detectedProjectPath);
      const blocks = await this.parseDirectoryFiles(files, undefined);

      if (blocks.length === 0) {
        throw new Error(
          "No valid terraform files found given path, try a different directory",
        );
      }

      const inputVars = await this.loadVars(blocks, this.tfvarsPaths);

      // Implement the rest of the parsing logic here

      return blocks; // Return the parsed result
    } catch (error) {
      console.error("Error parsing directory:", error);
      throw error;
    }
  }

  private async loadDirectory(fullPath: string): Promise<string[]> {
    const fileInfos = await fs.promises.readdir(fullPath, {
      withFileTypes: true,
    });
    const files: string[] = [];

    for (const info of fileInfos) {
      if (info.isDirectory()) continue;

      if (info.name.endsWith(".tf") || info.name.endsWith(".tf.json")) {
        files.push(path.join(fullPath, info.name));
      }
    }

    return files.sort();
  }

  private async parseDirectoryFiles(
    files: string[],
    moduleBlockId: string | undefined,
    moduleVariables: Record<string, any> = {},
  ): Promise<Block[]> {
    const finalBlocks: Block[] = [];

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, "utf-8");
        const parsed = hcl.parseToObject(content)[0];

        for (const [blockType, blocks] of Object.entries(parsed)) {
          let blockId = moduleBlockId
            ? `${moduleBlockId}.${blockType}`
            : blockType;
          if (blockType === "module") {
            for (const [name, details] of Object.entries(
              blocks as Record<string, any>,
            )) {
              const block = details[0];
              const moduleId = `${blockId}.${name}`;
              const moduleBlock: Block = {
                name: name,
                identifier: moduleId,
                hclBlock: block,
                moduleBlockId: moduleBlockId,
                blockType: blockType,
                inputs: {},
              };
              for (const [key, value] of Object.entries(block)) {
                if (key !== "source") {
                  moduleBlock.inputs![key] = value;
                }
              }
              finalBlocks.push(moduleBlock);

              if (block.source && block.source.startsWith(".")) {
                const resolvedPath = path.resolve(
                  path.dirname(file),
                  block.source,
                );
                const moduleFiles = await this.loadDirectory(resolvedPath);
                const moduleBlocks = await this.parseDirectoryFiles(
                  moduleFiles,
                  moduleId,
                );
                finalBlocks.push(...moduleBlocks);
              }
            }
          } else if (blockType === "resource" || blockType === "data") {
            for (let [name, block] of Object.entries(
              blocks as Record<string, any>,
            )) {
              block = Array.isArray(block) ? block[0] : block;
              for (const [key, value] of Object.entries(block)) {
                finalBlocks.push({
                  name: key,
                  identifier: `${blockId}.${name}.${key}`,
                  // @ts-ignore
                  hclBlock: value[0],
                  moduleBlockId: moduleBlockId,
                  blockType: blockType,
                  resourceType: name,
                });
              }
            }
          } else {
            for (const [name, details] of Object.entries(
              blocks as Record<string, any>,
            )) {
              const block = Array.isArray(details) ? details[0] : details;
              finalBlocks.push({
                name: name,
                identifier: `${blockId}.${name}`,
                hclBlock: block,
                moduleBlockId: moduleBlockId,
                blockType: blockType,
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Skipping file ${file}: ${error}`);
      }
    }

    return finalBlocks;
  }

  private replaceVariables(obj: any, variables: Record<string, any>): any {
    if (typeof obj === "string") {
      return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
        return variables[varName] !== undefined
          ? variables[varName]
          : `\${${varName}}`;
      });
    } else if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceVariables(item, variables));
    } else if (typeof obj === "object" && obj !== null) {
      const newObj: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        newObj[key] = this.replaceVariables(value, variables);
      }
      return newObj;
    }
    return obj;
  }

  private async loadVars(
    blocks: any[],
    filenames: string[],
  ): Promise<Map<string, any>> {
    const combinedVars = new Map(this.tfEnvVars);

    for (const filename of filenames) {
      await this.loadAndCombineVars(filename, combinedVars);
    }

    for (const [key, value] of this.inputVars) {
      combinedVars.set(key, value);
    }

    // Add default 'env' variable if not present
    if (!combinedVars.has("env")) {
      const env = this.workspaceName || this.envName;
      combinedVars.set("env", env);
    }

    return combinedVars;
  }

  private async loadAndCombineVars(
    filename: string,
    combinedVars: Map<string, any>,
  ): Promise<void> {
    const vars = await this.loadVarFile(filename);
    for (const [key, value] of vars) {
      combinedVars.set(key, value);
    }
  }

  private async loadVarFile(filename: string): Promise<Map<string, any>> {
    // Implement logic to load and parse var files
    return new Map();
  }

  // Implement other methods like ProjectName(), EnvName(), etc.
}
