variable "aws_region" {
  type    = string
  default = "us-west-2"
}

variable "lambda_name" {
  description = "Name of the Lambda; every other resource is named from it"
  type        = string
}

variable "stage_name" {
  type = string
}

variable "allowed_origins" {
  description = "Sites whose pages may call the reader (scheme and host, no trailing slash)"
  type        = list(string)
}

variable "anthropic_key_param" {
  description = "Name of the encrypted SSM parameter holding the model API key. Created by hand, never by Terraform."
  type        = string
  default     = "/adu-fit-check/anthropic-api-key"
}

variable "model" {
  type    = string
  default = "claude-opus-5-5"
}

variable "effort" {
  description = "How hard the model works on each survey: low, medium, high. Higher is slower and costs more."
  type        = string
  default     = "medium"
}

variable "reserved_concurrency" {
  description = "Most survey reads that can run at once"
  type        = number
  default     = 2
}

variable "api_rate_limit" {
  description = "Requests per second allowed through the stage"
  type        = number
  default     = 1
}

variable "api_burst_limit" {
  type    = number
  default = 2
}

variable "daily_quota" {
  description = "Hard cap on survey reads per day, enforced by API Gateway"
  type        = number
  default     = 200
}

variable "spike_per_hour" {
  description = "Alarm when this many reads happen in one hour"
  type        = number
  default     = 50
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic for alarms. Empty creates the alarms with no notification."
  type        = string
  default     = ""
}
