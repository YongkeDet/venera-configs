# Venera 漫蛙配置修复版

当前版本：**1.0.6**；最低 Venera 版本：1.4.0。

## 导入

在 Venera 的漫画源管理中选择从链接导入，使用以下地址：

https://raw.githubusercontent.com/YongkeDet/venera-configs/main/manwaba_fixed.js

导入后名称为“漫蛙吧（图片修复版）”。源标识保持 `manwaba_imagefix`，与此前本地修复版一致。

## 修复内容

- 保留 AES-CBC 图片解密、填充校验和图片格式校验。
- 分类直接请求当前分类域名，避免旧域名跳转。
- 分类使用 Venera 的 `dart:io` 请求方式，对 301/302/307/308 跳转保留 POST 方法和完整请求体，最多跟随 5 次。
- 设置本仓库为在线更新地址。

分类相关代码通过 41 项本地模拟回归检查，覆盖全部 24 个分类、筛选参数、请求方法与请求体保留，以及跳转异常。分类接口尚未完成在线实测。

## 来源

基于 venera-app/venera-configs 的 manwaba.js 1.0.3：

https://github.com/venera-app/venera-configs/blob/main/manwaba.js

图片加密格式参考 AXmishell 的修复提交：

https://github.com/venera-app/venera-configs/pull/314
