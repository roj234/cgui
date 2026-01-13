# CGUI / Chrome Generated UI 🚀
**Chrome驱动的超轻量嵌入式界面引擎，嵌入式界的Hexo**

`CGUI` 是一个 ~~Blazing fast~~ *打破常规* 的嵌入式 UI 框架。它主张 **“设计阶段~~极尽升华~~，运行阶段极致克制”**。  
通过 Chrome 解析 HTML/CSS 布局并在构建时光栅化，将现代 Web 的设计能力~~狠狠注入到~~资源受限的单片机中。

![参考图](FastChargingStation/browser.png)
![渲染到设备](FastChargingStation/device.jpg)  
(参考图显示效果差主要是我手机垃圾, 当然也可能便宜 TN 屏在手机和眼睛看来差异比较大)

> 警告：开发中，不保证 API 统一，不保证特性正常工作，请君稍等 v1.0.0

## 💣 降维打击

*   **设计即代码**：放弃笨重的 LVGL 或者乱糟糟的绝对定位吧。在 HTML 中使用最新最热 Flex 布局，剩下的交给最可爱的 Chrome 酱就行了~
*   **网页级质量**：利用 Chrome 的字体引擎生成带次像素抗锯齿的位图。单片机上的数字也能拥有 Google Fonts 的圆润感。
*   **零内存开销**：不维护复杂的组件树或上下文栈。所有的 UI 状态都被编译为单层 C 语言结构体，RAM 占用仅取决于你的业务数据。
*   **极致性能**：真正的细粒度增量更新。基于字符变更检测，只向 LCD 推送发生变化的单个字符(目前只支持左对齐或相同宽度时)。
*   **低端友好**：使用魔改的 QOI 格式对图像进行压缩，占用空间只有传统位图的 10-20%，`STM32F103C8T6` 也能上桌吃饭 

## ⚙ 工作流程

1.  **设计**：使用任意 HTML/CSS 编写 UI 设计稿。通过 `.cg-` CSS类标记动态数据，通过 `cg-alphabet` 指定字符集……
2.  **编译**：`npm run build`。脚本启动无头浏览器（_是的，如果你想可以使用火狐_）渲染页面，自动计算所有元素的分辨率、坐标、并提取位图。
3.  **引用**：脚本生成 `gui_XXX.h` 和 `gui_XXX.c`。包含 QOI 压缩的背景切片、字体掩模、以及自动生成的增量更新逻辑 `CG_xxx_Update()`。
4.  **部署**：驱动层最少仅需提供 `CG_HAL_setDrawWindow` `CG_HAL_drawPixel` 函数，可选 DMA 刷新支持（`CG_HAL_fillBatch`/`CG_HAL_fillArray`）。

## 🌟 特性

*   **字体引擎**：自动提取特定字符集，支持非等宽字体（WIP），支持单色（未实装）或彩色压缩位图。
*   **图像压缩**：集成 QOI 编码器，比原始 RGB565 大幅节省 Flash 空间。
*   **状态映射**：支持根据 C 语言变量值自动切换多个 class（如：`state == 0 ? .icon-off : .icon-on`）。
*   **背景恢复**：智能备份文本背景。数值变化时，先还原背景，再写入文字，彻底告别文字残留。

## 🚀 快速上手

### 1. 编写 HTML
在你的 `index.html` 中：

```html
<div class="cg-screen" id="MainScreen">
    <div class="label">Voltage</div>
    <!-- CGUI框架主要是为资源极度受限的单片机设计的，例如STM32F103系列，没有浮点运算单元 -->
    <!-- 因此，它只支持渲染定点小数，类似下面就是 voltage=123 时，显示 1.23V -->
    <div class="value"><span
            class="cg-number"
            cg-bind="status.voltage"
            cg-dataType="int32_t"
            cg-alphabet="0123456789.-">0.00</span><span class="cg-hide">V</span></div>
    <!-- 在这个示例中，我们手动填写了字母表，但事实上数字类型并不需要这么做（除非使用有符号数据类型，但确定不会出现负数等……） -->
    <!-- 顺便提一嘴，几乎所有的参数都不会在UI编译阶段校验，因为我还没想到好办法在JS里解析C语言 -->
    <!-- 避免踩坑：所有的动态字符元素，都应该是inline的（例如包在span里），这样才能正确测量单个字符的宽度！ -->
</div>
```

#### 🧩 核心指令集 (Directives)

CGUI 通过在 HTML 标签中添加 `cg-` 前缀的属性或类，来定义 UI 的动态行为。

| 指令 | 说明 | 示例 |
| :--- | :--- | :--- |
| `cg-bind` | **变量绑定**：关联 C 语言中的全局变量或结构体成员。 | `cg-bind="status.voltage"` |
| `cg-dataType` | **数据类型**：指定 C 变量类型，用于生成对应的 `Update` 函数参数。 | `cg-dataType="uint16_t"` |
| `cg-alphabet` | **字符集提取**：强制 Chrome 只为这些字符生成位图掩模，极大压缩 Flash。 | `cg-alphabet="0123456789:."` |
| `cg-number` | **数值渲染**：高性能渲染，支持定点小数映射。 | `<span class="cg-number">0.00</span>` |
| `cg-string` | **动态字符串**：用于显示状态文本，支持变长显示。 | `<span class="cg-string">Normal</span>` |
| `cg-bar` | **进度条**：自动映射数值到宽度/高度。需两层 HTML 嵌套。 | `<div class="cg-bar" cg-dir="right">...</div>` |
| `cg-image` | **动态图形**：根据 C 变量值切换 CSS Class（如颜色、透明度、背景）。 | `cg-if-1="> 50\|bg-red-50" cg-else="bg-green-50"` |
| `cg-renderer` | **自定义渲染器**：绑定一段 C 代码逻辑来格式化显示内容（如时间转换）。 | `cg-renderer="#MyTimer"` |

> 有关它完整的能力，例如条、列表、嵌套，请见[桌面充电站示例](FastChargingStation/index.html)

#### 🛠 高级用法：C 逻辑注入

CGUI 允许在设计阶段直接编写 C 代码片段，实现自定义显示逻辑。

**1. 局部上下文变量**  
在 `.cg-screen` 内部编写脚本，定义仅供该屏幕使用的临时变量，减少重复代码：
```html
<script type="text/c" class="cg-code">
  // 这里的代码会直接注入到生成的 Update/Init 函数开头
  SW3538_Status* ch = &status.channel[activeChannel >> 1];
</script>
```

**2. 自定义格式化渲染器 (`cg-renderer`)**
处理类似 `00:01:23` 这种无法直接通过单一数值显示的格式。
```html
<script type="text/c" id="RenderHMS" cg-bufferSize="8">
  // val 是由 cg-bind 传入的原始数据
  uint32_t i = val;
  buf[0] = (i / 36000) + '0'; // 格式化逻辑...
  buf[7] = (i % 10) + '0';
  buf[8] = 0; // 别忘了在字符串末尾写0
  return buf; // 返回处理后的字符串指针
</script>
```

### 2. 生成代码
* 我使用的是 NodeJS 22，并且我在 package.json 中禁止安装了很多针对低版本 Node 的 polyfill
* 哥们，你都用 Chrome 设计界面了，不会还在用 NodeJS 8 吧
```bash
npm run build [HTML file]
```
将会编译这个网页中每一个具有 `id` 的 `.cg-screen` , 并生成 `output/gui_<文件名>.h` 和 `output/gui_<文件名>.c`

### 3. C 语言调用
这些头文件提供了极度简单的接口：

```c
#include "cgui.h"
#include "gui_FastChargingStation.h"

CG_MainScreen_State ui_state;

void main() {
    LCD_Init();
    CG_MainScreen_Init(&ui_state); // 显示背景和初始状态

    while(1) {
        // 更新业务数据
        status.voltage = ADC_Get_Voltage();
        
        // 自动检测并执行局部刷新
        CG_MainScreen_Update(&ui_state);
    }
}
```

## 📊 性能表现 (160x128 屏幕示例)
*   **静态内存 (RAM)**: 至少 256 字节的栈用于解压缩 + 数十字节结构体 (上一次的状态)。
*   **代码量 (Flash)**: 4KB 固件代码 + 取决于位图数量，一个界面可能十几KB。

## ⛏ 技术栈 (按初次使用时间从早到晚排序)
* **[GBK.JS](https://github.com/cnwhy/GBK.js)**: 中文二分查找提升性能
* **魔改QOI ([Quite OK Image format](https://github.com/phoboslab/qoi))**: 压缩位图
* **Selenium**: 自动化截图

---

**CGUI - 让我们在 90 年代的硬件 (是的，我只有64.0KB闪存) 上渲染 2026 年的设计，这正是 2026 年嵌入式开发该有的样子。**