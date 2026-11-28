# Playbox POS Tools

平板和电脑使用同一份油猴脚本。在 Tampermonkey 中导入需要的脚本，刷新 Odoo 页面即可使用。

## Chrome 已启用脚本

2026-11-28 从 Tampermonkey 同步，共 13 份。点击名称查看脚本源码。

| 脚本 | Chrome 版本 |
| --- | --- |
| [配货中心 正式版](./playbox-fulfillment.user.js) | 1.2.18.8 |
| [补货提醒](./playbox-replenishment.user.js) | 0.1.28 |
| [快捷调货](./playbox-transfer.user.js) | 0.2.16 |
| [优惠](./playbox-discount.user.js) | 0.2.11 |
| [仓库路线与收藏](./playbox-warehouse-routes.user.js) | 1.0.22 |
| [包装条码与单位](./playbox-packaging-barcodes.user.js) | 1.0.20 |
| [历史库存查询](./playbox-stock-history.user.js) | 1.0.26 |
| [商品与购物车](./playbox-products-cart.user.js) | 1.0.17 |
| [小票与打印](./playbox-receipt-printing.user.js) | 1.0.17 |
| [拆色与制造](./playbox-color-manufacturing.user.js) | 1.0.17 |
| [现金明细](./playbox-cash-details.user.js) | 1.0.17 |
| [界面与快捷操作](./playbox-ui-shortcuts.user.js) | 1.0.17 |
| [订单工具](./playbox-order-tools.user.js) | 1.0.17 |

## 发布版下载 · 配货、补货与调货

[下载三份脚本 ZIP](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/Playbox-Inventory-Tools.zip)

| 脚本 | 版本 | 单独下载 |
| --- | --- | --- |
| 配货中心 | 1.2.13 | [安装配货中心](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/playbox-fulfillment.user.js) |
| 补货提醒 | 0.1.28 | [安装补货提醒](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/playbox-replenishment.user.js) |
| 快捷调货 | 0.2.16 | [安装快捷调货](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/playbox-transfer.user.js) |

配货中心支持扫描单件码和小盒码。商品搜索下拉框展开时可以直接连续扫码。收到完整条码后，脚本收起搜索结果并高亮对应商品。

## POS 优惠

[单独下载优惠脚本](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/playbox-discount.user.js) · [下载优惠和快捷调货两份脚本 ZIP](https://github.com/Leslia98/Playbox-POS-Tools/releases/latest/download/Playbox-POS-Tools.zip)

以上下载地址始终指向最新发布版。ZIP 可直接从油猴的导入工具打开，也可以解压后逐份安装。已安装同一脚本时，选择更新已有脚本。

[查看发布记录](https://github.com/Leslia98/Playbox-POS-Tools/releases) · [优惠与调货 0.2.2 历史说明](./usage-0.2.2.txt)
