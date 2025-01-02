module "gcp_project" {
  source       = "../modules/gcp_project"
  project_name = "infra-new-dev"
  project_id   = "infra-new-dev"
}

module "database" {
  source          = "../modules/cloud_sql"
  gcp_project_id  = module.gcp_project.project_id
  public_ip       = true
  private_network = module.gcp_project.default_network

  depends_on = [module.gcp_project]
}

output "db_connection_info" {
  value     = module.database
  sensitive = true
}
