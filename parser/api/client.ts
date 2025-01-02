export interface AttributeFilter {
  key: string;
  value?: string;
  valueRegex?: string;
}

export interface ProductQuery {
  productFilter: ProductFilter;
  priceFilter?: PriceFilter;
}

interface ProductFilter {
  vendorName?: string;
  service?: string;
  productFamily?: string;
  region?: string;
  sku?: string;
  attributeFilters?: AttributeFilter[];
}

interface PriceFilter {
  purchaseOption?: string;
  unit?: string;
  description?: string;
  descriptionRegex?: string;
  startUsageAmount?: string;
  endUsageAmount?: string;
  termLength?: string;
  termPurchaseOption?: string;
  termOfferingClass?: string;
}

export interface Product {
  productHash?: string;
  vendorName?: string;
  service?: string;
  sku?: string;
  productFamily?: string;
  attributes?: object;
  region?: string;
  prices?: Price[];
}

export interface Price {
  usd?: string;
  purchaseOption?: string;
  unit?: string;
}

export interface CostApiClient {
  fetchProducts(
    queries: ProductQuery[],
  ): Promise<{ query: ProductQuery; products: Product[] }[]>;
}
