# resource "google_storage_bucket" "nearline" {
#   name          = "my-bucket"
#   location      = "US"
#   storage_class = "NEARLINE"
# }

# resource "google_storage_bucket" "archive" {
#   name          = "my-bucket"
#   location      = "US"
#   storage_class = "ARCHIVE"
# }

# resource "google_sql_database_instance" "my-db" {
#   name             = "my-database"
#   region           = "us-central1"
#   database_version = "POSTGRES_9_6"

#   settings {
#     tier = "db-standard-2"
#     ip_configuration {
#       ipv4_enabled = true
#     }
#   }
# }


module "database" {
  source = "./modules/database"
  cpu    = 2
  memory = 3840
}

module "bucket" {
  source        = "./modules/bucket"
  storage_class = "NEARLINE"
}
