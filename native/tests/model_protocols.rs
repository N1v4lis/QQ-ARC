use qqaf_native::{
    model_protocols::{self, Protocol},
    prices,
};
use serde_json::json;
#[test]
fn claude_tool_results_are_user_blocks_and_credentials_never_enter_urls() {
    let body = json!({"model":"claude-fixture","messages":[{"role":"system","content":"system"},{"role":"user","content":"hello"},{"role":"assistant","content":"","tool_calls":[{"id":"call_1","function":{"name":"remember","arguments":"{\"content\":\"fixture\"}"}}]},{"role":"tool","tool_call_id":"call_1","content":"{\"ok\":true}"}],"tools":[{"function":{"name":"remember","description":"save","parameters":{"type":"object"}}}]});
    let (url, wire, protocol) =
        model_protocols::prepare("https://api.anthropic.com", &body).unwrap();
    assert_eq!(protocol, Protocol::Claude);
    assert_eq!(url.as_str(), "https://api.anthropic.com/v1/messages");
    assert_eq!(wire["messages"][2]["content"][0]["type"], "tool_result");
    assert_eq!(wire["messages"][2]["content"][0]["tool_use_id"], "call_1");
    assert!(wire["tools"][0].get("input_schema").is_some());
    let result=model_protocols::normalize(protocol,json!({"content":[{"type":"text","text":"hello"},{"type":"tool_use","id":"call_2","name":"finish","input":{}}],"usage":{"input_tokens":12,"output_tokens":4}})).unwrap();
    assert_eq!(
        result["choices"][0]["message"]["tool_calls"][0]["id"],
        "call_2"
    );
    assert_eq!(result["usage"]["prompt_tokens"], 12);
    assert!(model_protocols::prepare("https://token@api.anthropic.com", &body).is_err());
}
#[test]
fn gemini_thought_signatures_survive_tool_round_trip() {
    let response=model_protocols::normalize(Protocol::Gemini,json!({"candidates":[{"content":{"parts":[{"thought":true,"text":"private reasoning"},{"functionCall":{"name":"remember","args":{"content":"fixture"}},"thoughtSignature":"fixture-signature"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":5}})).unwrap();
    let message = &response["choices"][0]["message"];
    assert_eq!(message["content"], "");
    let id = message["tool_calls"][0]["id"].clone();
    let (_,wire,p)=model_protocols::prepare("https://generativelanguage.googleapis.com",&json!({"model":"gemini-fixture","messages":[{"role":"user","content":"hello"},message,{"role":"tool","tool_call_id":id,"content":"{\"ok\":true}"}]})).unwrap();
    assert_eq!(p, Protocol::Gemini);
    assert_eq!(
        wire["contents"][1]["parts"][1]["thoughtSignature"],
        "fixture-signature"
    );
    assert_eq!(
        wire["contents"][2]["parts"][0]["functionResponse"]["name"],
        "remember"
    );
    let (_, _, p) = model_protocols::prepare(
        "https://proxy.invalid/v1",
        &json!({"model":"gemini-fixture"}),
    )
    .unwrap();
    assert_eq!(p, Protocol::OpenAi);
}
#[test]
fn standard_and_conditional_prices_are_distinguished() {
    let glm = prices::parse(
        "glm",
        "| 模型 | 输入价格 | 输出价格 |\n|---|---|---|\n|glm-fixture|1 元|4 元|\n",
    )
    .unwrap();
    assert_eq!(glm[0]["in"], 1.0);
    assert_eq!(glm[0]["out"], 4.0);
    assert_eq!(glm[0]["autoApply"], true);
    let gemini=prices::parse("gemini",r#"<h2 id="gemini-fixture">model</h2><h3>Standard</h3><table><tr><td>Input price</td><td>Free</td><td>$1</td></tr><tr><td>Output price</td><td>Free</td><td>$4</td></tr></table>"#).unwrap();
    assert_eq!(gemini[0]["autoApply"], true);
    let conditional = prices::parse(
        "qwen",
        "| Model | Input | Output |\n|---|---|---|\n|qwen-fixture|1 元|4 元|\n",
    )
    .unwrap();
    assert_eq!(conditional[0]["autoApply"], false);
}

#[test]
fn official_image_blocks_are_translated_from_inline_protocol_content() {
    let body = json!({"model":"fixture","messages":[{"role":"user","content":[{"type":"text","text":"describe"},{"type":"image_url","image_url":{"url":"data:image/png;base64,AAAA"}}]}]});
    let (_, claude, _) = model_protocols::prepare("https://api.anthropic.com", &body).unwrap();
    assert_eq!(
        claude["messages"][0]["content"][1]["source"]["type"],
        "base64"
    );
    assert_eq!(
        claude["messages"][0]["content"][1]["source"]["media_type"],
        "image/png"
    );
    let mut gemini = body;
    gemini["model"] = json!("gemini-fixture");
    let (_, wire, _) =
        model_protocols::prepare("https://generativelanguage.googleapis.com", &gemini).unwrap();
    assert_eq!(
        wire["contents"][0]["parts"][1]["inlineData"]["data"],
        "AAAA"
    );
}
