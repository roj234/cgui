/**
 * @file cgui.h
 * @brief Chrome Generated UI 公共头文件 - 超轻量级嵌入式图形库
 * @copyright Roj234 2026
 * @note 适用于 CGUI 代码生成器 1.x 版本
 * @note 这些 API 只应该被生成的代码使用，保留所有增删改函数定义的权利
 * @note 如果你觉得函数名称很怪：请记住，我喜欢 Java
 */

#ifndef _CG_H
#define _CG_H

#include <stdint.h>
#include <stddef.h>

/* ---------------- 基础宏定义与配置 ---------------- */

#define CG_isEmptyString(s) (!*(s))

typedef const char* string;
typedef size_t uintptr_t;
typedef void* pointer;

#ifndef CG_BPP
	#define CG_BPP 16
#endif

#if CG_BPP == 16
	typedef uint16_t color_t;
	#ifdef CG_Manual_BGR
		#define CG_Color(x) ( (x >> 11) | (x & 2016) | ((x & 31) << 11) )
	#else
		#define CG_Color(x) x
//#define CG_888_TO_565(x) CG_Color( ((x >> 8) & 63488) | ((x >> 5) & 2016) | ((x >> 3) & 31) )
	#endif
// 等我手上有这么高端的硬件了再说 (需要QOI888了)
/*#elif CG_BPP == 24
	typedef uint32_t color_t;
	#ifdef CG_Manual_BGR
		#define CG_Color(x) ( (x >> 16) | (x & 65280) | ((x & 255) << 16) )
	#else
		#define CG_Color(x) x
	#endif*/
#else
	#error Unsupported CG_BPP config
#endif

/**
 * @brief 背景色, 如果一些函数必须覆盖液晶屏中的数据, 应该如何填充
 * @note 牢记: CGUI没有帧缓冲区！
 * @note 现在指我在QOI565格式中预留的透明色 (0xFF 字节)
 */
extern color_t CG_Background;
/**
 * @brief 前景色, 字体的位图填充需要(因为没地方加参数)
 */
extern color_t CG_Foreground;

// 关于函数命名 draw/fill
// fill是填充位图, 会覆盖受影响区域(经过增量更新之后)的所有内容
// draw支持1bit透明(空心), 不过在SPI LCD上性能会很差, 可能慢十几倍

/* ---------------- 硬件抽象层 (HAL) 接口 ---------------- */
/* 以下函数需要根据具体的显示驱动（如 SPI-LCD）实现 */

/**
 * @brief 设置显示屏的绘图矩形区域（窗口）
 * @note 调用后驱动应处于数据发送模式，随后的像素数据将填充此区域
 * @param x_start 起点 X 坐标 (包含)
 * @param y_start 起点 Y 坐标 (包含)
 * @param x_end   终点 X 坐标 (不包含)
 * @param y_end   终点 Y 坐标 (不包含)
 */
void CG_HAL_setDrawWindow(uint16_t x_start, uint16_t y_start, uint16_t x_end, uint16_t y_end);

/**
 * @brief 结束绘图模式
 * @note 某些驱动在发送完像素后需要拉高 CS 或发送停止指令，在此实现
 */
void CG_HAL_endDraw(void);

/**
 * @brief 向当前窗口写入单个像素颜色
 * @param color 颜色值
 */
void CG_HAL_drawPixel(color_t color);

/**
 * @brief 快速填充多个相同颜色的像素（批量写入优化）
 * @param color 填充颜色
 * @param count 像素数量
 * @note 可选, 有默认实现
 */
void CG_HAL_fillBatch(color_t color, uint32_t count);
/**
 * @brief 快速填充一个数组的像素（批量写入优化）
 * @param color 填充颜色数组
 * @param count 像素数量
 * @note 可选, 有默认实现
 */
void CG_HAL_fillArray(const color_t* color, uint32_t count);

/* ---------------- 图像绘制 ---------------- */

typedef const uint8_t* ImageData;

/**
 * @brief 图像资源结构体
 */
typedef struct {
  ImageData data;   ///< 像素数据指针
  uint16_t width;   ///< 宽度 (px)
  uint16_t height;  ///< 高度 (px)
} CG_Image;
typedef const CG_Image* Image;

/**
 * @brief 图像压缩方式 (目前只有字体使用)
 * @note 每一种都需要显式定义 CG_Compression_XX_Used 宏
 */
typedef enum {
    CG_Compression_QOI         = 0, ///< QOI 压缩的全色位图
    CG_Compression_PackBits    = 1, ///< PackBits 压缩的单色位图
    CG_Compression_Monochrome  = 2, ///< 单色位图 (不支持不压缩的全色位图)
} CG_Compression;

/**
 * @brief 绘制图像
 */
void CG_fillImage(
	ImageData image,
	uint16_t x, uint16_t y,
	uint16_t width, uint16_t height
);

/**
 * @brief 绘制图像的局部区域（裁剪）
 * @param srcX, srcY 图像内部的起始偏移坐标
 */
void CG_fillImageRegion(
	Image image,
	uint16_t srcX, uint16_t srcY,

	uint16_t x, uint16_t y,
	uint16_t width, uint16_t height
);

/**
 * @brief 绘制单色图像
 * @note fg为1, bg为0
 */
void CG_fillPackBits(
	ImageData image,
	uint16_t x, uint16_t y,
	uint16_t width, uint16_t height,
	color_t fgColor, color_t bgColor
);

/* ---------------- 字符串绘制 ---------------- */

/**
 * @brief 字符串长度 支持NULL
 */
size_t CG_stringLength(string str);

#define CG_FontData_Undef 0xFFFF
/**
 * @brief 字体资源结构体
 * @note 并非必须使用GBK, 但必须是双字节编码, 我们没有那么多资源
 */
typedef struct {
    const pointer ascii_map;     ///< ASCII 字符索引表
    const pointer gbk_map;       ///< GBK 字符索引表
    const pointer pool;          ///< 字模原始数据池
    uint16_t gbk_cnt;            ///< GBK 字符总数 (总是二分搜索)
    uint8_t ascii_cnt;           ///< ASCII 字符总数
    uint8_t ascii_offset;        ///< ASCII 起始偏移 (为0代表二分搜索)
    uint8_t width;               ///< 字体宽度 (为0可变宽度)
    uint8_t height;              ///< 字体高度
    CG_Compression compression;  ///< 字体压缩方式
} CG_Font;
typedef const CG_Font* Font;

#define CG_FillIsImage(val) ((val) >= (1 << CG_BPP))

/**
 * @brief 绘制文本
 * @param prev 与text对比，仅刷新变化的字符（不用时传入""，不可为NULL）
 * @return uint16_t 绘制后的终点 X 坐标
 */
uint16_t CG_fillText(
	Font font, uint16_t x, uint16_t y,
	string text, string prev
);

/**
 * @brief 绘制文本（左对齐，带背景填充）
 * @param fill 背景填充颜色 或 指向 CG_Image 的指针 (见 CG_FillIsImage)
 */
uint16_t CG_fillTextLA(
	Font font, uint16_t x, uint16_t y,
	string text, string prev,
	uintptr_t fill
);
/**
 * @brief 绘制文本（右对齐）
 * @param x 这里的 x 是左边界起点 (未来可能更改)
 */
uint16_t CG_fillTextRA(
	Font font, uint16_t x, uint16_t y,
	string text, string prev,
	uintptr_t fill
);

/**
 * @brief 绘制文本（居中对齐）
 * @param width 居中区域的总宽度
 */
void CG_fillTextCA(
	Font font, uint16_t x, uint16_t y,
	uint16_t width,
	string text, string prev,
	uintptr_t fill
);

/* ---------------- 数字函数 ---------------- */

/**
 * @brief 获取十进制整数对应的字符串长度
 */
size_t CG_decimalLength(int32_t n);

/**
 * @brief 将有符号数字转换为字符串并格式化
 * @param buf 目标缓冲区 (最多占用13字节, 包含末尾0时)
 * @param digits 小数点位数 (没有填-1, 不能为0)
 * @param value 整数值
 * @return string 指向结果字符串的指针
 */
char* CG_decimalToString(
	char* buf,
	int8_t digits,
	int32_t value
);

/**
 * @brief 简化版的snprintf, 支持左填充, %d, %x, %s, %c, 以及N位定点小数 %pNd
 * @param buf 目标缓冲区
 * @param bufSize 缓冲区的大小(包括末尾的\0)
 * @param format
 * @return int_fast16_t 若缓冲区无限大, 写入的字节数
 */
int_fast16_t CG_printf(
	char* buf, 
	const size_t bufSize,
	string format, 
	...
);

/* ---------------- 组件绘制函数 ---------------- */

typedef enum {
    CG_DIR_LEFT,
    CG_DIR_RIGHT,
    CG_DIR_TOP,
    CG_DIR_BOTTOM,
} CG_Direction;

/**
 * @brief 增量更新进度条渲染
 * @param newValue 当前进度值
 * @param oldValue 上次进度值（用于局部刷新）
 * @param fullImg  已填充部分引用的图像
 * @param emptyImg 未填充部分引用的图像
 */
void CG_fillProgressBar(
    uint16_t x, uint16_t y,
    uint16_t newValue, uint16_t oldValue,
    uintptr_t fullId, uintptr_t emptyId,
    CG_Direction direction
);

/* ---------------- 绘图(Plot)函数 ---------------- */

// 注：没有清屏函数，因为CGUI不知道屏幕多大，实现HAL的时候应该会顺便实现这个吧
// 实在没有你也可以调用fillRect嘛

/**
 * @brief 绘制一个点
 */
void CG_drawPixel(uint16_t x, uint16_t y, color_t color);

/**
 * @brief 绘制填充的矩形
 */
void CG_fillRect(uint16_t x, uint16_t y, uint16_t w, uint16_t h, color_t color);
/**
 * @brief 绘制空心的矩形
 */
void CG_drawRect(uint16_t x, uint16_t y, uint16_t w, uint16_t h, color_t color);

// By: Alois Zingl https://zingl.github.io/bresenham.html

/**
 * @brief Bresenham 算法画线
 */
void CG_drawLine(int16_t x1, int16_t y1, int16_t x2, int16_t y2, color_t color);
/**
 * @brief Bresenham 算法画圆
 */
void CG_drawCircle(uint16_t x, uint16_t y, uint16_t radius, color_t color);
/**
 * @brief Bresenham 算法画二次贝塞尔曲线
 */
void CG_drawQuadBezier(
	int16_t x0, int16_t y0,
	int16_t x1, int16_t y1,
	int16_t x2, int16_t y2,
	color_t color
);

typedef struct {
    size_t* value;
    uint16_t valueSize;
    uint16_t cursor;

    uint16_t x, y, w, h;
    color_t color;
} CG_LineGraph_t;

// 折线图! 虽然可能并不是折线
void CG_drawLineGraph(CG_LineGraph_t *graph, size_t newValue);
void CG_drawLineGraphAA(CG_LineGraph_t *graph, size_t newValue);

void CG_debugPrint(uint16_t x, uint16_t y, string str);

#endif /* _CG_H */
