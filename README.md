# 五行卡牌查询静态版

这是从主工程导出的纯静态查询站点，适合部署到 Netlify、GitHub Pages、Cloudflare Pages 等静态托管服务。

本仓库只保存发布产物，不保存整理脚本、源数据库、PSD 或规则研究过程。

## 更新方式

1. 在主工程更新数据库和前端。
2. 在主工程重新生成 `site_export/`。
3. 将 `site_export/` 的内容同步到本仓库根目录。
4. 提交并推送本仓库。

## Netlify 设置

- Build command: 留空
- Publish directory: `.`
