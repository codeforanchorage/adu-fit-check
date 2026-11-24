// config.js: where the page finds the survey reader (Phase 4, see lambda/ and terraform/aws/).
//
// url   the address "Read survey with AI" posts the survey image to. Leave it empty and the
//       button never appears; everything else on the page works without it.
// key   an API Gateway key. It is PUBLIC BY DESIGN and is not a secret: its only job is to
//       tie each request to a usage plan with a daily quota, which limits how many paid model
//       calls can be made in a day. Anyone can copy it, so one person could use up the day's
//       quota for everyone; the spend limit on the model provider's side is the firm ceiling. The model API key is a different thing. It lives only on
//       the server, in an encrypted parameter, and must never appear in this repository.
//
// After a deploy, both values come from:
//   terraform -chdir=terraform/aws output -raw read_survey_url
//   terraform -chdir=terraform/aws output -raw page_key
// An address offered as "Try an example" under the address box, for people who want to see
// the page work before typing their own. Any Anchorage Bowl address in a residential district
// works. Leave it empty to hide the button.
export const EXAMPLE_ADDRESS="1400 W 23RD AVE";

export const SURVEY_READER={url:"https://61ifxlzls9.execute-api.us-west-2.amazonaws.com/prod/read-survey",key:"CzOCMnaDoEqvZ5z7nGwn5bOlhAeyZMt8sYwP79d4"};
