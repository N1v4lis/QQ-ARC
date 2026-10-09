use futures_util::StreamExt;
use serde_json::Value;
pub fn client(cfg: &Value) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_millis(
        cfg["api"]["timeoutMs"]
            .as_u64()
            .unwrap_or(120000)
            .clamp(1000, 600000),
    ));
    if cfg["proxy"]["enabled"] == true {
        let address = cfg["proxy"]["url"].as_str().ok_or("代理地址为空")?;
        let url = reqwest::Url::parse(address).map_err(|_| "代理地址无效")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("代理需要不含凭据的 HTTP/HTTPS 地址".into());
        }
        builder = builder.proxy(reqwest::Proxy::all(url).map_err(|_| "代理配置失败")?);
    }
    builder.build().map_err(|_| "HTTP 客户端配置失败".into())
}
pub async fn bytes(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("响应超过大小限制".into());
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "响应读取失败")?;
        if body.len() + chunk.len() > limit {
            return Err("响应超过大小限制".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
pub async fn json(response: reqwest::Response) -> Result<Value, String> {
    serde_json::from_slice(&bytes(response, 4 * 1024 * 1024).await?)
        .map_err(|_| "响应 JSON 格式无效".into())
}
pub fn plain(html: &str) -> String {
    let removed = regex::Regex::new(r"(?is)<(?:script|style)\b[^>]*>.*?</(?:script|style)>")
        .unwrap()
        .replace_all(html, "");
    let removed = regex::Regex::new(r"<[^>]*>")
        .unwrap()
        .replace_all(&removed, " ");
    let mut text = removed.into_owned();
    for (from, to) in [
        ("&amp;", "&"),
        ("&quot;", "\""),
        ("&apos;", "'"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&nbsp;", " "),
    ] {
        text = text.replace(from, to);
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn public(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && ip.octets()[0] != 0
                && ip.octets()[0] < 224
                && !(ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
        }
        std::net::IpAddr::V6(ip) => ip.to_ipv4_mapped().map(|v| public(v.into())).unwrap_or(
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && ip.segments()[0] & 0xfe00 != 0xfc00
                && ip.segments()[0] & 0xffc0 != 0xfe80,
        ),
    }
}
pub async fn fetch_public(cfg: &Value, address: &str) -> Result<String, String> {
    Ok(plain(&String::from_utf8_lossy(
        &fetch_public_bytes(cfg, address, 4 * 1024 * 1024).await?,
    ))
    .chars()
    .take(18000)
    .collect())
}
pub async fn fetch_public_bytes(
    cfg: &Value,
    address: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let mut url = reqwest::Url::parse(address).map_err(|_| "网页地址无效")?;
    for _ in 0..6 {
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("网页地址无效".into());
        }
        let host = url.host_str().ok_or("网页地址无效")?.to_string();
        if cfg["security"]["browseLock"]["enabled"] == true
            && !cfg["security"]["browseLock"]["hosts"]
                .as_array()
                .is_some_and(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .any(|allowed| host == allowed || host.ends_with(&format!(".{allowed}")))
                })
        {
            return Err("网站不在浏览白名单中".into());
        }
        let addresses: Vec<_> =
            tokio::net::lookup_host((host.as_str(), url.port_or_known_default().unwrap()))
                .await
                .map_err(|_| "域名解析失败")?
                .collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public(a.ip())) {
            return Err("网页访问不允许内网或本机地址".into());
        }
        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(&host, &addresses)
            .timeout(std::time::Duration::from_secs(20));
        if cfg["proxy"]["enabled"] == true {
            let proxy = cfg["proxy"]["url"].as_str().ok_or("代理地址为空")?;
            let checked = reqwest::Url::parse(proxy).map_err(|_| "代理地址无效")?;
            if !matches!(checked.scheme(), "http" | "https")
                || !checked.username().is_empty()
                || checked.password().is_some()
            {
                return Err("代理地址无效".into());
            }
            builder = builder.proxy(reqwest::Proxy::all(checked).map_err(|_| "代理配置失败")?);
        }
        let http = builder.build().map_err(|_| "网页客户端失败")?;
        let response = http
            .get(url.clone())
            .send()
            .await
            .map_err(|_| "网页请求失败")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("网页重定向无效")?;
            url = url.join(location).map_err(|_| "网页重定向无效")?;
            continue;
        }
        return bytes(response, limit).await;
    }
    Err("网页重定向过多".into())
}
