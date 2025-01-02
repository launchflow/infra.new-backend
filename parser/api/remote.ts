import {
  AttributeFilter,
  CostApiClient,
  ProductQuery,
  Product,
  Price,
} from "./client";
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  NormalizedCacheObject,
  gql,
  DocumentNode,
} from "@apollo/client";

export class InfraNewCostApiClient implements CostApiClient {
  private appoloClient: ApolloClient<NormalizedCacheObject>;
  constructor() {
    this.appoloClient = new ApolloClient({
      cache: new InMemoryCache(),
      link: new HttpLink({
        uri: "http://localhost:8000/v1/products/graphql",
      }),
    });
  }

  async fetchProducts(queries: ProductQuery[]) {
    const results = await Promise.all(
      queries.map(async (query) => {
        const gqlQuery = buildGraphQLQuery(query);
        // console.log(gqlQuery.loc?.source["body"]);
        const { data } = await this.appoloClient.query({ query: gqlQuery });
        const products: Product[] = data.products.map((product: any) => ({
          productHash: product.productHash,
          sku: product.sku,
          attributes: product.attributes,
          prices: product.prices.map((price: any) => ({
            purchaseOption: price.purchaseOption,
            unit: price.unit,
            usd: price.usd,
          })),
        }));
        return { query: query, products: products };
      }),
    );

    return results;
  }
}

function buildGraphQLQuery(query: ProductQuery): DocumentNode {
  const { productFilter, priceFilter } = query;

  // Helper function to build filter arguments
  const buildFilterArgs = (filter: any): string => {
    return Object.entries(filter)
      .filter(([key, value]) => value !== undefined)
      .map(([key, value]) => {
        if (key === "attributeFilters" && Array.isArray(value)) {
          const attributeFilter = `${key}: [${(value as AttributeFilter[])
            .map(
              (af) =>
                `{key: "${af.key}"${af.value ? `, value: "${af.value}"` : ""}${af.valueRegex ? `, valueRegex: ${JSON.stringify(af.valueRegex)}` : ""}}`,
            )
            .join(", ")}]`;
          return attributeFilter;
        }
        return `${key}: "${value}"`;
      })
      .join(", ");
  };

  const productFilterArgs = buildFilterArgs(productFilter);
  const priceFilterArgs = priceFilter ? buildFilterArgs(priceFilter) : "";

  return gql`
    {
      products(filter: {${productFilterArgs}}) {
        productHash
        sku
        service
        attributes
        prices(filter: {${priceFilterArgs}}) {
          purchaseOption
          unit
          usd
        }
      }
    }
  `;
}
