import { ResourceQueryFactory } from "./resource";
import { GCSStorageBucketQuery } from "./gcp/storage_bucket";
import { SQLDatabaseInstanceQuery } from "./gcp/sql_database_instance";
import { ArtifactRegistryRepositoryQuery } from "./gcp/artifact_registry_repository";
import { BigQueryDatasetQuery } from "./gcp/bigquery_dataset";
import { BigQueryTableQuery } from "./gcp/bigquery_table";
import { CloudRunServiceQuery } from "./gcp/cloud_run_v2_service";
import { CloudRunV2JobQuery } from "./gcp/cloud_run_v2_job";
import { CloudFunctionsFunctionQuery } from "./gcp/cloudfunctions_function";
import { ComputeAddressQuery } from "./gcp/compute_address";
import { ComputeDiskQuery } from "./gcp/compute_disk";
import { ComputeForwardingRuleQuery } from "./gcp/compute_forwarding_rule";
import { ComputeImageQuery } from "./gcp/compute_image";
import { ComputeInstanceQuery } from "./gcp/compute_instance";

export const tofuRegistry: Record<string, ResourceQueryFactory<any>> = {
  // GCP Resources
  google_storage_bucket: GCSStorageBucketQuery,
  google_sql_database_instance: SQLDatabaseInstanceQuery,
  google_artifact_registry_repository: ArtifactRegistryRepositoryQuery,
  google_bigquery_dataset: BigQueryDatasetQuery,
  google_bigquery_table: BigQueryTableQuery,
  google_cloud_run_v2_service: CloudRunServiceQuery,
  google_cloud_run_v2_job: CloudRunV2JobQuery,
  google_cloudfunctions_function: CloudFunctionsFunctionQuery,
  google_compute_address: ComputeAddressQuery,
  google_compute_disk: ComputeDiskQuery,
  google_compute_forwarding_rule: ComputeForwardingRuleQuery,
  google_compute_image: ComputeImageQuery,
  google_compute_instance: ComputeInstanceQuery,
};
