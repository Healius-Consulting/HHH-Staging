variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "europe-west2"
}
variable "base_domain" { type = string }
variable "images" {
  type        = object({ public = string, pharmacy = string, admin = string, api = string })
  description = "Immutable Artifact Registry image references, preferably pinned by digest."
}
variable "additional_auth_domains" {
  type        = list(string)
  default     = []
  description = "Existing Firebase auth domains that must remain authorised."
}
variable "ip_hash_secret_id" {
  type    = string
  default = "hhh-ip-hash-secret"
}
variable "min_instances" {
  type    = number
  default = 1
}
variable "max_instances" {
  type    = number
  default = 20
}
variable "enable_hsts" {
  type        = bool
  default     = false
  description = "Enable only after every production subdomain has valid HTTPS."
}
