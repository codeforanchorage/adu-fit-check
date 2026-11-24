# The survey reader for ADU Fit Check (Phase 4): one Lambda behind a REST API.
# Laid out like the Code for Anchorage MCP fleet (Terraform, own state, us-west-2,
# reserved concurrency, stage throttle, four alarms, 14 and 30 day logs), with
# three differences, each for a reason:
#   - Tag Project = adu-fit-check, not mcp-server. This is not an MCP server, and
#     the fleet's dashboard, probe and 4xx alarms key on that tag.
#   - Not behind the shared fleet firewall, which blocks request bodies over 8 KB.
#     A survey image is several hundred KB.
#   - The route needs an API Gateway key. The key is public (it is in the page);
#     its only job is to attach the usage plan's daily quota, which is the hard
#     cap on how many paid model calls can be made in a day.
#
# Build and deploy with scripts/deploy_survey.sh, which makes the zip first.

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  backend "s3" {
    bucket         = "adu-fit-check-tfstate"
    key            = "survey-reader/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project = "adu-fit-check"
    }
  }
}

data "aws_caller_identity" "me" {}

locals {
  zip_path  = "${path.module}/survey-reader.zip"
  param_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.me.account_id}:parameter${var.anthropic_key_param}"
  alarms    = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

# ---------------------------------------------------------------- Lambda

resource "aws_iam_role" "lambda" {
  name = "${var.lambda_name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# The only other thing the function may do: read its one model key.
# The parameter itself is created by hand and is never in this state.
resource "aws_iam_role_policy" "read_key" {
  name = "read-model-key"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = "ssm:GetParameter"
      Effect   = "Allow"
      Resource = local.param_arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.lambda_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "reader" {
  function_name    = var.lambda_name
  role             = aws_iam_role.lambda.arn
  filename         = local.zip_path
  source_code_hash = filebase64sha256(local.zip_path)
  handler          = "handler.lambda_handler"
  runtime          = "python3.14"
  memory_size      = 512
  timeout          = 28 # API Gateway gives up at 29

  # A spike, or someone trying to run up the bill, cannot fan out past this.
  # Set to 0 to switch the reader off:
  #   aws lambda put-function-concurrency --function-name <name> --reserved-concurrent-executions 0
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      ANTHROPIC_KEY_PARAM = var.anthropic_key_param
      ALLOWED_ORIGINS     = join(",", var.allowed_origins)
      MODEL               = var.model
      EFFORT              = var.effort
    }
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_cloudwatch_log_group.lambda]
}

# ---------------------------------------------------------------- API Gateway

resource "aws_api_gateway_rest_api" "api" {
  name        = "${var.lambda_name}-api"
  description = "ADU Fit Check survey reader"
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_resource" "read" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "read-survey"
}

resource "aws_api_gateway_method" "post" {
  rest_api_id      = aws_api_gateway_rest_api.api.id
  resource_id      = aws_api_gateway_resource.read.id
  http_method      = "POST"
  authorization    = "NONE"
  api_key_required = true # ties every call to the usage plan's daily quota
}

# The browser's preflight carries no key, so OPTIONS is open. The Lambda answers it
# without calling the model.
resource "aws_api_gateway_method" "options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.read.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.read.id
  http_method             = aws_api_gateway_method.post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.reader.invoke_arn
}

resource "aws_api_gateway_integration" "options" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.read.id
  http_method             = aws_api_gateway_method.options.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.reader.invoke_arn
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reader.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# Errors the gateway raises itself (no key, over quota, throttled) never reach the
# Lambda, so they need the cross-origin header here or the page cannot read them.
resource "aws_api_gateway_gateway_response" "cors_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  response_type = "DEFAULT_4XX"
  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin" = "'*'"
  }
}

resource "aws_api_gateway_gateway_response" "cors_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  response_type = "DEFAULT_5XX"
  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin" = "'*'"
  }
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_resource.read.id,
      aws_api_gateway_method.post.id,
      aws_api_gateway_method.post.api_key_required,
      aws_api_gateway_method.options.id,
      aws_api_gateway_integration.post.id,
      aws_api_gateway_integration.options.id,
      aws_api_gateway_gateway_response.cors_4xx.response_parameters,
      aws_api_gateway_gateway_response.cors_5xx.response_parameters,
    ]))
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.lambda_name}-access"
  retention_in_days = 30
}

# Access logging relies on the account-level API Gateway CloudWatch role, which the
# mcp-stats repo owns (mcp-fleet-apigw-cloudwatch). It was in place on 2026-11-24.
resource "aws_api_gateway_stage" "prod" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.stage_name

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    # No request body, no query string and no user agent. The address a survey belongs
    # to never reaches this service at all.
    format = jsonencode({
      requestTime        = "$context.requestTime"
      requestId          = "$context.requestId"
      httpMethod         = "$context.httpMethod"
      resourcePath       = "$context.resourcePath"
      status             = "$context.status"
      sourceIp           = "$context.identity.sourceIp"
      integrationLatency = "$context.integrationLatency"
      responseLength     = "$context.responseLength"
    })
  }
}

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  method_path = "*/*"
  settings {
    throttling_rate_limit  = var.api_rate_limit
    throttling_burst_limit = var.api_burst_limit
  }
}

# The daily cap. Every POST must carry the page's key, and the key belongs to this plan.
resource "aws_api_gateway_usage_plan" "page" {
  name = "${var.lambda_name}-usage-plan"
  api_stages {
    api_id = aws_api_gateway_rest_api.api.id
    stage  = aws_api_gateway_stage.prod.stage_name
  }
  quota_settings {
    limit  = var.daily_quota
    period = "DAY"
  }
  throttle_settings {
    rate_limit  = var.api_rate_limit
    burst_limit = var.api_burst_limit
  }
}

resource "aws_api_gateway_api_key" "page" {
  name        = "${var.lambda_name}-page"
  description = "Public by design: shipped in the ADU Fit Check page. It only attaches the daily quota."
}

resource "aws_api_gateway_usage_plan_key" "page" {
  key_id        = aws_api_gateway_api_key.page.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.page.id
}

# ---------------------------------------------------------------- alarms

resource "aws_cloudwatch_metric_alarm" "errors" {
  alarm_name          = "${var.lambda_name}-lambda-errors"
  alarm_description   = "The survey reader Lambda is returning errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.reader.function_name }
  alarm_actions       = local.alarms
  ok_actions          = local.alarms
}

resource "aws_cloudwatch_metric_alarm" "throttles" {
  alarm_name          = "${var.lambda_name}-lambda-throttles"
  alarm_description   = "The survey reader hit its concurrency limit"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.reader.function_name }
  alarm_actions       = local.alarms
  ok_actions          = local.alarms
}

resource "aws_cloudwatch_metric_alarm" "slow" {
  alarm_name          = "${var.lambda_name}-lambda-duration-near-timeout"
  alarm_description   = "Survey reads are close to API Gateway's 29 second limit. Consider a Lambda Function URL."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 2
  threshold           = 28 * 1000 * 0.8
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.reader.function_name }
  alarm_actions       = local.alarms
  ok_actions          = local.alarms
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.lambda_name}-apigw-5xx"
  alarm_description   = "The survey reader API is returning server errors"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    ApiName = aws_api_gateway_rest_api.api.name
    Stage   = aws_api_gateway_stage.prod.stage_name
  }
  alarm_actions = local.alarms
  ok_actions    = local.alarms
}

# Each call costs money at the model provider, so a burst of use is worth knowing about
# well before the daily quota is reached.
resource "aws_cloudwatch_metric_alarm" "spike" {
  alarm_name          = "${var.lambda_name}-request-spike"
  alarm_description   = "Unusually many survey reads in one hour"
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.spike_per_hour
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.reader.function_name }
  alarm_actions       = local.alarms
}
