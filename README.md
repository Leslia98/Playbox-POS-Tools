# Playbox POS Tools

Odoo Online POS 的「优惠」和「快捷调货」两份独立 Tampermonkey 脚本。

## 下载与安装

- [两份脚本安装 ZIP](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/Playbox-POS-Tools.zip)
- [优惠脚本](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/playbox-discount.user.js)
- [快捷调货脚本](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/playbox-transfer.user.js)
- [版本与说明](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest)

这些固定地址始终指向本仓库最新发布版。下载 ZIP 后解压，将两份 `.user.js` 导入 Tampermonkey，更新同名脚本，再刷新 POS。不要同时启用旧副本。

## 0.2.2

快捷调货按选定界面精修：路线标签、型号与颜色同行、来源库存和每箱件数、箱/件数量控件及换算，中西语与小屏布局。优惠继续使用原生商品行折扣，算法未改变。

适用地址：`https://*.odoo.com/pos/*`。基于 Odoo 19 POS；地址通用不代表兼容所有 Odoo 版本。配置按网站、公司、POS 隔离，收藏和待处理索引保存在当前电脑。

## 验证范围

29 项本地回归及脚本语法检查通过；Edge 界面对照、数量操作、中西语、窄屏和测试库实际 POS 样式已检查。本轮没有提交付款或调拨。优惠算法此前在测试库验证过原生部分退款与总额、库存恢复。

0.2.2 油猴安装后的冷启动、正式环境业务、关账会计分录、发票和实际打印设备尚未验收。完整说明见 [usage-0.2.2.txt](./usage-0.2.2.txt)。

仅包含本次两份脚本和说明；不包含订单、配置备份或测试记录。不新增 Odoo 模型、字段、compute 或服务器动作。
