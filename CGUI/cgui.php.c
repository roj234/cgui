/**
 * @file cgui.c
 * @brief Chrome Generated UI 超轻量级嵌入式图形库
 * @copyright Roj234 2026
 */

#include "cgui.h"
#include <stdarg.h>

#if !_IL_SingleObjectMode || CG_NeedHALFallback
__WEAK void CG_HAL_fillBatch(color_t color, uint32_t count) {
    while (count) {
        count--;
        CG_HAL_drawPixel(color);
    }
}
__WEAK void CG_HAL_fillArray(const color_t* color, uint32_t count) {
    while (count) {
        count--;
        CG_HAL_drawPixel(*color++);
    }
}
#endif

color_t CG_Foreground, CG_Background;

#if CG_BPP == 16

static uint8_t _CG_QOI_Hash[64*3];
#define tab _CG_QOI_Hash

/**
 * 解码并绘制图像
 *
 * @param in           压缩数据流指针
 * @param pixelCount   绘制多少个像素
 */
_IL_FORCEINLINE void _CG_DecodeImage(
  const uint8_t* in,
  uint_fast32_t pixelCount
) {
  uint8_t r = 0, g = 0, b = 0;
  color_t color;

  while (pixelCount) {
    uint8_t b1 = *in++;
    switch (b1 >> 6) {
      case 0: { // INDEX
        b1 *= 3;
        r = tab[b1];
        g = tab[b1 + 1];
        b = tab[b1 + 2];
        break;
      }
      case 1: { // DIFF
        r += ((b1 >> 4) & 3) - 2;
        g += ((b1 >> 2) & 3) - 2;
        b += (b1 & 3) - 2;
        break;
      }
      case 2: { // LUMA
        uint8_t b2 = *in++;
        int8_t vg = (b1 & 0x3F) - 32;
        r += vg - 8 + ((b2 >> 4) & 0x0F);
        g += vg;
        b += vg - 8 + (b2 & 0x0F);
        break;
      }
      case 3: {
        if (b1 >= 254) {
          if (b1 == 255) {
            color = CG_Background;
            goto pixel_ready;
          } else { // RGB
            color_t tmp = (*in++ << 8);
            tmp |= *in++;
            r = (tmp >> 11) & 31;
            g = (tmp >> 5) & 63;
            b = tmp & 31;
          }
        } else { // RLE
          size_t repeatCount = (b1 & 0x3F) + 1;
          pixelCount -= repeatCount;

#ifdef CG_Manual_BGR
          color = ((color_t)b << 11) | ((color_t)g << 5) | r;
#else
          color = ((color_t)r << 11) | ((color_t)g << 5) | b;
#endif

          CG_HAL_fillBatch(color, repeatCount);
          continue;
        }
      }
    }

  {
    uint_fast8_t h = (((color_t)r * 3 + (color_t)g * 5 + (color_t)b * 7) & 63) * 3;
    tab[h] = r;
    tab[h + 1] = g;
    tab[h + 2] = b;
  }

#ifdef CG_Manual_BGR
    color = ((color_t)b << 11) | ((color_t)g << 5) | r;
#else
    color = ((color_t)r << 11) | ((color_t)g << 5) | b;
#endif

    pixel_ready:
    CG_HAL_drawPixel(color);
    pixelCount--;
  }
}

/**
 * 解码并绘制部分图像，跳过startOffset后，对于剩下的count个像素，每解码imageWidth个，只渲染width个，并且height--直到为零
 */
_IL_FORCEINLINE void _CG_DecodePartialImage(
  const uint8_t* in,
  const uint_fast32_t startOffset, // skipCount
  uint_fast16_t imageWidth,
  uint_fast16_t width, uint_fast16_t height
) {
  uint8_t r = 0, g = 0, b = 0;
  /*union {
    struct {
      unsigned r: 5;
      unsigned g: 6;
      unsigned b: 5;
    } color,
    uint16_t data
  }*/
  color_t color;

  uint_fast16_t nextBorder = startOffset;
  bool inLcdRegion = false;

  while (1) {
    uint_fast8_t repeatCount = 1;

    uint8_t b1 = *in++;
    switch (b1 >> 6) {
      case 0: { // INDEX
        b1 *= 3;
        r = tab[b1];
        g = tab[b1 + 1];
        b = tab[b1 + 2];
        break;
      }
      case 1: { // DIFF
        r += ((b1 >> 4) & 3) - 2;
        g += ((b1 >> 2) & 3) - 2;
        b += (b1 & 3) - 2;
        break;
      }
      case 2: { // LUMA
        uint8_t b2 = *in++;
        int8_t vg = (b1 & 0x3F) - 32;
        r += vg - 8 + ((b2 >> 4) & 0x0F);
        g += vg;
        b += vg - 8 + (b2 & 0x0F);
        break;
      }
      case 3: {
        if (b1 >= 254) {
          if (b1 == 255) {
            color = CG_Background;
            goto pixel_ready;
          } else { // RGB
            color_t tmp = (*in++ << 8);
            tmp |= *in++;
            r = (tmp >> 11) & 31;
            g = (tmp >> 5) & 63;
            b = tmp & 31;
          }
        } else { // RLE
          repeatCount = (b1 & 0x3F) + 1;

#ifdef CG_Manual_BGR
          color = ((color_t)b << 11) | ((color_t)g << 5) | r;
#else
          color = ((color_t)r << 11) | ((color_t)g << 5) | b;
#endif

          if (nextBorder >= repeatCount) {
            nextBorder -= repeatCount;

            CG_HAL_fillBatch(color, repeatCount);
            continue;
          }
          goto pixel_ready;
        }
      }
    }

  {
    uint_fast8_t h = (((color_t)r * 3 + (color_t)g * 5 + (color_t)b * 7) & 63) * 3;
    tab[h] = r;
    tab[h + 1] = g;
    tab[h + 2] = b;
  }

#ifdef CG_Manual_BGR
    color = ((color_t)b << 11) | ((color_t)g << 5) | r;
#else
    color = ((color_t)r << 11) | ((color_t)g << 5) | b;
#endif

    pixel_ready:
    while(repeatCount) {
      if (!nextBorder) {
        if (!height) return;

        if (inLcdRegion) {
          nextBorder = imageWidth - width;
          if (!nextBorder) goto renderAll;
          inLcdRegion = false;
        } else {
            inLcdRegion = true;
            renderAll:
            nextBorder = width;
            height--;
        }
      }
      nextBorder--;
      repeatCount--;

      if (inLcdRegion)
        CG_HAL_drawPixel(color);
    }
  }
}

#undef tab
#endif // CG_BPP == 16

void CG_fillImage(
	ImageData image,
	uint16_t x, uint16_t y,
	uint16_t width, uint16_t height
) {
  CG_HAL_setDrawWindow(x, y, x + width, y + height);
  size_t pixels = width * height;
  _CG_DecodeImage(image, pixels);
}

void CG_fillImageRegion(
	Image image,
	uint16_t srcX, uint16_t srcY,

	uint16_t x, uint16_t y,
	uint16_t width, uint16_t height
) {
  CG_HAL_setDrawWindow(x, y, x + width, y + height);
  _CG_DecodePartialImage(
    image->data,
    (srcY) * image->width + (srcX),
    image->width,
    width, height
  );
}

_IL_FORCEINLINE void _CG_RenderBitmap(
	uint8_t packedBits,
	color_t zeroColor, color_t oneColor
) {
	uint_fast16_t bit = 1;
	do {
		CG_HAL_drawPixel( packedBits&bit ? oneColor : zeroColor );
		bit <<= 1;
	} while(bit != 256);
}

void CG_fillPackBits(
	ImageData image,
	uint16_t x, uint16_t y,
	uint16_t width, uint16_t height,
	color_t fgColor, color_t bgColor
) {
    CG_HAL_setDrawWindow(x, y, x + width, y + height);
    uint_fast32_t pixels = width * height;

    while (pixels--) {
        int8_t code = (int8_t)*image++;
        if (code >= 0) { // Literal
            uint_fast8_t count = code + 1;
            while (count--) _CG_RenderBitmap(*image++, bgColor, fgColor);
        } else if (code != -128) { // Repeat
            uint_fast8_t count = -code + 1;
            uint8_t value = *image++;
            while (count--) _CG_RenderBitmap(value, bgColor, fgColor);
        }
    }
}

/* ---------------- 字符串绘制 ---------------- */

size_t CG_stringLength(string str) {
	if (!str) return 0;

	string init_str = str;
	while(*str) str++;
	return (str - init_str);
}

typedef const struct {
	uint16_t offset;
	uint8_t code;
} *_CG_FontTableMono8;

typedef const struct {
	uint16_t offset;
	uint16_t code;
} *_CG_FontTableMono16;

<?php
#error Use PHP to process me
function generateBS($u) {
	echo "
_IL_FORCEINLINE size_t _CG_BS$u(_CG_FontTableMono$u a, uint16_t high, uint{$u}_t chr) {
	size_t low = 0;

	while (low < high) {
		size_t mid = (low + high) >> 1;
		//size_t mid = low + ((high - low) >> 1);
		int32_t midVal = a[mid].code - chr;

		// TODO: 编译器会使用ZF还是什么吗？
		if (midVal < 0) low = mid + 1;
		else if (midVal > 0) high = mid;
		else return mid;
	}

	return CG_FontData_Undef;
}
";
}
generateBS(8);
generateBS(16);
?>

_IL_FORCEINLINE void _CG_fillASCII(Font font, uint16_t x, uint16_t y, char c) {
	uintptr_t fontData = NULL;

	if (font->ascii_offset) {
		int8_t idx = c - font->ascii_offset;
		if (idx >= 0 && idx < font->ascii_cnt) {
#ifdef CG_Compression_Monochrome_Used
			if (font->pool == NULL) {
				size_t size = (font->width * font->height + 7) >> 3;
				fontData = (uintptr_t)font->ascii_map + size * idx;
				goto decompression_bitmap;
			} else
#endif
			{
				uint16_t offset = ((const uint16_t*)font->ascii_map)[idx];
				if (offset != CG_FontData_Undef) fontData = ((uintptr_t)font->pool) + offset;
			}
		}
	} else {
		size_t idx = _CG_BS8(
			(_CG_FontTableMono8)font->ascii_map,
			font->ascii_cnt,
			c
		);

		if (idx != CG_FontData_Undef) {
			fontData = ((uintptr_t)font->pool) + ((_CG_FontTableMono8)font->ascii_map + idx)->offset;
		}
	}

	if (fontData) {
		switch (font->compression) {
			default:
#ifdef CG_Compression_QOI_Used
			case CG_Compression_QOI:
				CG_fillImage((ImageData)fontData, x, y, font->width, font->height);
			break;
#endif
#ifdef CG_Compression_PackBits_Used
			case CG_Compression_PackBits:
				CG_drawPackBits(
					(ImageData)fontData, x, y, font->width, font->height,
					CG_Foreground, CG_Background
				);
			break;
#endif
#ifdef CG_Compression_Monochrome_Used
			case CG_Compression_Monochrome:
				decompression_bitmap:
				CG_HAL_setDrawWindow(x, y, x + font->width, y + font->height);

				string fontData1 = (string)fontData;
				size_t remaining = (font->width * font->height + 7) >> 3;

				// TODO 把字模反过来存储，这样可以利用ZeroFlag寄存器
				for(size_t h = 0; h < remaining; h++) {
					uint8_t font_bit = fontData1[h];
					_CG_RenderBitmap(font_bit, CG_Background, CG_Foreground);
				}
			break;
#endif
		}
	}
}

/**
 * CG_fillText 等宽字体
 * @implNote 双字节编码的两个字符必须都大于127
 */
uint16_t CG_fillText(
	Font font,
	uint16_t x, uint16_t y,
	string text, string /*&*/prev
) {
	while (*text) {
		uint8_t c1 = *text;
		uint8_t c2 = *prev;

#ifdef CG_GBK
		if (c1 > 127) {
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
			uint16_t u1 = ((uint16_t)c1 << 8) | (uint16_t)text[1];
			uint16_t u2 = (c2 > 127) ? (((uint16_t)c2 << 8) | (uint16_t)prev[1]) : 0;
#else
			uint16_t u1 = (uint16_t)c1 | (uint16_t)text[1] << 8;
			uint16_t u2 = (c2 > 127) ? ((uint16_t)c2 | (uint16_t)prev[1] << 8) : 0;
#endif

			if (u1 != u2) {
				size_t idx = _CG_BS16(
					(_CG_FontTableMono16)font->gbk_map,
					font->gbk_cnt,
					u1
				);

				if (idx != CG_FontData_Undef) {
					uintptr_t fontData = font->pool + ((_CG_FontTableMono16)font->gbk_map + idx)->offset;
					CG_fillImage((ImageData)fontData, x, y, font->width * 2, font->height);
				}
			}

			text += 2;
			if (c2 > 127) prev += 2;
			else if (c2) prev += 1;

			x += font->width * 2;
			continue;
		}
#endif

		if (c1 != c2) {
			_CG_fillASCII(font, x, y, c1);
		}

		text++;
		if (c2) prev++;

		x += font->width;
	}

	return x;
}

uint16_t CG_fillTextLA(
	Font font, uint16_t x, uint16_t y,
	string text, string prev,
	uintptr_t fill
) {
	uint16_t new_x = CG_fillText(font, x, y, text, prev);

	uint_fast16_t lenOld = CG_stringLength(prev);
	uint_fast16_t lenNew = CG_stringLength(text);
	int_fast16_t remain = lenOld- lenNew;

	if (remain > 0) {
#ifdef CG_TEXTURE_FILL
		if (CG_FillIsImage(fill)) {
			CG_fillImageRegion(
				(Image)fill,
				new_x - x, 0,

				new_x, y,
				font->width * remain, font->height
			);
		} else
#endif
			CG_fillRect(new_x, y, new_x + font->width * remain, y + font->height, fill);
	}

	return new_x;
}

uint16_t CG_fillTextRA(
	Font font, uint16_t x, uint16_t y,
	string text, string prev,
	uintptr_t fill
) {
	// TODO 填充prev，以避免全部重绘
	uint_fast16_t lenOld = CG_stringLength(prev);
	uint_fast16_t lenNew = CG_stringLength(text);
    uint16_t new_start_x = x - lenNew * font->width;
    uint16_t old_start_x = x - lenOld * font->width;

	if (lenOld != lenNew) {
		prev = "";
		if (old_start_x < new_start_x) {
#ifdef CG_TEXTURE_FILL
		if (CG_FillIsImage(fill)) {
			CG_fillImageRegion(
				(Image)fill,
				0, 0,

				old_start_x, y,
				new_start_x - old_start_x, font->height
			);
		} else
#endif
			CG_fillRect(old_start_x, y, new_start_x, y + font->height, fill);
		}
	}

	CG_fillText(font, new_start_x, y, text, prev);
	return x;
}

void CG_fillTextCA(
	Font font, uint16_t x, uint16_t y,
	uint16_t width,
	string text, string prev,
	uintptr_t fill
) {
	uint_fast16_t lenOld = CG_stringLength(prev);
	uint_fast16_t lenNew = CG_stringLength(text);

	uint_fast16_t x_offset = (width - lenNew * font->width) / 2;
	if (lenOld != lenNew) {
		prev = "";

		if (lenOld > lenNew) {
#ifdef CG_TEXTURE_FILL
		if (CG_FillIsImage(fill)) {
			// TODO 左右各填充部分 (但是对Texture Fill可能消耗双倍的CPU时间)
			CG_fillImage(
				((Image)fill)->data,
				x, y,
				width, font->height
			);
		} else
#endif
			CG_fillRect(x, y, x + width, y + font->height, fill);
		}
	}

	CG_fillText(font, x + x_offset, y, text, prev);
}

/* ---------------- 数字函数 ---------------- */

size_t CG_decimalLength(int32_t n) {
	if (n == (int32_t)0x80000000) return 10;
	if (n < 0) return CG_decimalLength(-n)+1;

	if (n < 100000) /* 1 <= digit count <= 5 */ {
		if (n < 100) /* 1 <= digit count <= 2 */
			return (n < 10) ? 1 : 2;
		else /* 3 <= digit count <= 5 */
			if (n < 1000) return 3;
			else /* 4 <= digit count <= 5 */
				return (n < 10000) ? 4 : 5;
	} else /* 6 <= digit count <= 10 */
		if (n < 10000000) /* 6 <= digit count <= 7 */
			return (n < 1000000) ? 6 : 7;
		else /* 8 <= digit count <= 10 */
			if (n < 100000000) return 8;
			else /* 9 <= digit count <= 10 */
				return (n < 1000000000) ? 9 : 10;
}

static const char _CG_digitsx[16] = "0123456789abcdef";
static const char _CG_digitsX[16] = "0123456789ABCDEF";

char* CG_itoa(
	char* str,
	int8_t digits,
	uint32_t val
) {
#ifndef CG_NoDiv
    do {
        uint32_t tmp = val / 10;
        *--str = _CG_digitsx[val - tmp * 10];
        val = tmp;

        if (--digits == 0) *--str = '.';
    } while (val != 0);
#else
    int32_t r, q;

    while (val > 0xFFFF) {
        q = (uint64_t)(val * 0xCCCCCCCDULL) >> (35); // q = val / 10
        r = val - ((q << 3) + (q << 1)); // r = val - q * 10
        val = q;

        *--str = r+'0';

        if (--digits == 0) *--str = '.';
    }

    do {
        q = (uint32_t)(val * 52429) >> (16 + 3); // q = val / 10
        r = val - ((q << 3) + (q << 1)); // r = val - q * 10
        val = q;

        *--str = r+'0';
        if (--digits == 0) *--str = '.';
    } while (val != 0);
#endif

    while (digits >= 0) {
        *(--str) = '0';
        if (--digits == 0) *(--str) = '.';
    }

    return str;
}

char* CG_decimalToString(
	char* str,
	int8_t digits,
	int32_t value
) {
    bool isNegative = value < 0;
    if (isNegative) value = -value;

    *(--str) = '\0';
    str = CG_itoa(str, digits, value);
    if (isNegative) *(--str) = '-';

    return str;
}

static inline void _CG_putc(char *buf, size_t size, size_t *pos, char c) {
    if (*pos < size - 1) buf[*pos] = c;
    (*pos)++;
}

int_fast16_t CG_printf(char* buf, size_t size, string fmt, ...) {
    char sb[12]; // 214748364.8
    sb[11] = 0;

    va_list args;
    va_start(args, fmt);
    size_t pos = 0;

    char c;
    while ((c = *fmt++) != '\0') {
        if (c != '%') { _CG_putc(buf, size, &pos, c); continue; }

        int width = 0;
        char pad = ' ';
        if (*fmt == '0') {
            pad = '0';
            fmt++;
        }
        while (*fmt >= '0' && *fmt <= '9') {
            width = width * 10 + (*fmt++ - '0');
        }

        int dot = -1;
        char* str;
        int len;

        switch (*fmt++) {
            case 'p': {
                dot = *fmt - '0';
                fmt += 2; // 忽略了错误处理
            }
            case 'd': {
                uint32_t val = va_arg(args, uint32_t);

                if ((int32_t)val < 0) {
                    _CG_putc(buf, size, &pos, '-');
                    val = -val;
                }

                str = CG_decimalToString(&sb[sizeof(sb) - 1], dot, val);

                len = sb + sizeof(sb) - 1 - str;
                goto flush_string;
            }
            case 'x':
            case 'X': {
                uint32_t val = va_arg(args, uint32_t);
                str = &sb[sizeof(sb) - 1];

                const char* digits = fmt[-1] == 'X' ? _CG_digitsX : _CG_digitsx;
                do {
                    *--str = digits[val & 0xF];
                    val >>= 4;
                } while (val);

                len = sb + sizeof(sb) - 1 - str;
                goto flush_string;
            }
            case 's': {
                str = va_arg(args, char *);
                if (!str) str = "NULL";

                len = CG_stringLength(str);

                flush_string:
                while (len < width) {
                    _CG_putc(buf, size, &pos, pad);
                    len++;
                }

                while (*str) _CG_putc(buf, size, &pos, *str++);
                break;
            }
            case 'c': {
                char c1 = (char)va_arg(args, int);
                _CG_putc(buf, size, &pos, c1);
                break;
            }
            default:
                _CG_putc(buf, size, &pos, fmt[-1]);
            break;
        }
    }

    if (size > 0) {
        buf[pos < size ? pos : size - 1] = '\0';
    }

    va_end(args);
    return (int_fast16_t)pos;
}


/* ---------------- 组件绘制函数 ---------------- */

void CG_fillProgressBar(
    uint16_t x, uint16_t y,
    uint16_t newValue, uint16_t oldValue,
    uintptr_t fullId, uintptr_t emptyId,
    CG_Direction direction
) {
    // UI_Init中会出现这种情况 (fillImageRegion碰到宽或高=0时会越界访问)
    if (newValue == oldValue) return;

    // 2. 确定增量区域的属性
    // 如果新值 > 旧值：说明进度在增加，我们需要从 fullId 提取“新增部分”覆盖到屏幕
    // 如果新值 < 旧值：说明进度在减少，我们需要从 emptyId 提取“退回部分”覆盖到屏幕
    // TODO 支持单色背景/前景
    Image targetImg = (Image) ((newValue > oldValue) ? fullId : emptyId);

    uint_fast16_t start = (newValue > oldValue) ? oldValue : newValue;
    uint_fast16_t end = (newValue > oldValue) ? newValue : oldValue;
    uint_fast16_t diff = end - start;

    // 3. 根据方向计算裁切坐标 (imageX, imageY) 和 屏幕坐标 (drawX, drawY)
    switch (direction) {
        case CG_DIR_RIGHT:
            // 变化区域在水平方向：[x + start, x + end]
            CG_fillImageRegion(targetImg,
                start, 0,           // 逻辑裁切点
                x + start, y,       // 屏幕对应点
                diff, targetImg->height
            );
            break;

        case CG_DIR_LEFT:
            // 镜像逻辑：起始点在右侧
            // 假设总宽为 W，newValue=10 表示距离右侧边缘 10px
            {
                uint16_t W = targetImg->width;
                CG_fillImageRegion(targetImg,
                    W - end, 0,
                    x + (W - end), y,
                    diff, targetImg->height
                );
            }
            break;

        case CG_DIR_BOTTOM:
            // 变化区域在垂直方向
            CG_fillImageRegion(targetImg,
                0, start,
                x, y + start,
                targetImg->width, diff
            );
            break;

        case CG_DIR_TOP:
            // 镜像逻辑：起始点在底部
            {
                uint16_t H = targetImg->height;
                CG_fillImageRegion(targetImg,
                    0, H - end,
                    x, y + (H - end),
                    targetImg->width, diff
                );
            }
            break;
    }
}

/* ---------------- 绘图(Plot)函数 ---------------- */

void CG_drawPixel(uint16_t x, uint16_t y, color_t color) {
  CG_HAL_setDrawWindow(x, y, x + 1, y + 1);
  CG_HAL_drawPixel(color);
}

void CG_fillRect(
	uint16_t x, uint16_t y,
	uint16_t w, uint16_t h,
	color_t color
) {
    CG_HAL_setDrawWindow(x, y, x + w, y + h);
    CG_HAL_fillBatch(color, (uint32_t)w * h);
}

void CG_drawRect(uint16_t x, uint16_t y, uint16_t w, uint16_t h, color_t color) {
    if (w == 0) return;

    // 1. 画顶部横线
    CG_fillRect(x, y, w, 1, color);

    // 如果高度大于 1，才需要画底部和侧边
    if (h <= 1) return;
    CG_fillRect(x, y + h - 1, w, 1, color);

    // 如果高度大于 2，才需要画两侧的竖线
    if (h > 2) {
        CG_fillRect(x, y + 1, 1, h - 2, color);

        // 如果宽度大于 1，再画右侧竖线
        if (w > 1) CG_fillRect(x + w - 1, y + 1, 1, h - 2, color);
    }
}

// By: Alois Zingl https://zingl.github.io/bresenham.html
void CG_drawLine(int16_t x1, int16_t y1, int16_t x2, int16_t y2, color_t color) {
    int_fast16_t dx = abs(x2 - x1);
    int_fast16_t dy = -abs(y2 - y1);
    int_fast16_t sx = x1 < x2 ? 1 : -1;
    int_fast16_t sy = y1 < y2 ? 1 : -1;
    int_fast16_t err = dx + dy; // 误差变量
    int_fast16_t e2;

    while (1) {
        CG_drawPixel(x1, y1, color);
        if (x1 == x2 && y1 == y2) break;

        e2 = 2 * err;
        // 如果误差允许，向 x 方向走一步
        if (e2 >= dy) {
            err += dy;
            x1 += sx;
        }
        // 如果误差允许，向 y 方向走一步
        if (e2 <= dx) {
            err += dx;
            y1 += sy;
        }
    }
}
void CG_drawCircle(uint16_t x, uint16_t y, uint16_t radius, color_t color) {
   int_fast16_t dx = -radius, dy = 0;
   int_fast16_t err = 2 - 2 * radius;
   do {
      CG_drawPixel(x - dx, y + dy, color);
      CG_drawPixel(x - dy, y - dx, color);
      CG_drawPixel(x + dx, y - dy, color);
      CG_drawPixel(x + dy, y + dx, color);

      radius = err;
      if (radius <= dy) err += ++dy * 2 + 1;
      if (radius > dx || err > dy) err += ++dx * 2 + 1;
   } while (dx < 0);
}

void CG_drawQuadBezier(
	int16_t x0, int16_t y0,
	int16_t x1, int16_t y1,
	int16_t x2, int16_t y2,
	color_t color
) {
    int_fast16_t sx = x2 - x1, sy = y2 - y1;
    int_fast64_t xx = x0 - x1, yy = y0 - y1, xy;
    int_fast64_t dx, dy, err, cur = xx * sy - yy * sx;

    // 确保梯度不改变符号（由调用者保证，或在此处拆分曲线）
    // assert(xx*sx <= 0 && yy*sy <= 0);

    if (sx * (int_fast64_t)sx + sy * (int_fast64_t)sy > xx * xx + yy * yy) {
        x2 = x0; x0 = sx + x1; y2 = y0; y0 = sy + y1; cur = -cur;
    }

    if (cur != 0) {
        xx += sx; xx *= sx = x0 < x2 ? 1 : -1;
        yy += sy; yy *= sy = y0 < y2 ? 1 : -1;
        xy = 2 * xx * yy; xx *= xx; yy *= yy;

        if (cur * sx * sy < 0) {
            xx = -xx; yy = -yy; xy = -xy; cur = -cur;
        }

        dx = 4LL * sy * cur * (x1 - x0) + xx - xy;
        dy = 4LL * sx * cur * (y0 - y1) + yy - xy;
        xx += xx; yy += yy; err = dx + dy + xy;

        do {
            CG_drawPixel(x0, y0, color);
            if (x0 == x2 && y0 == y2) return;

            int y_step = 2 * err < dx;
            if (2 * err > dy) {
                x0 += sx; dx -= xy; err += dy += yy;
            }
            if (y_step) {
                y0 += sy; dy -= xy; err += dx += xx;
            }
        } while (dy < dx);
    }
    CG_drawLine(x0, y0, x2, y2, color);
}

void CG_drawLineGraph(CG_LineGraph_t *graph, size_t newValue) {

}

void CG_drawLineGraphAA(CG_LineGraph_t *graph, size_t newValue) {

}

_IL_INLINE void CG_debugPrint(uint16_t x, uint16_t y, string str) {
	CG_fillText(&_CG_FALLBACK_FONT, x, y, str, "");
}
