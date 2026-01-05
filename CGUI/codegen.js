import {BufferCache} from "./cache.js";
import {decodeImage, QOI565Encoder, RGB32To565} from "./qoi.js";
import {FontCodeGen} from "./codegen_font.js";
import UPNG from "upng-js";
import fs from "fs";
import {funcPrefix, getRelativeDataSize, printBuffer} from "./utils.js";

const DUMP_IMAGE = false;

export class CodeGen {
	constructor(fileName) {
		this.header = "";
		this.code = "";

		this.fileName = fileName;
		this.renderedScreens = [];
		this.dataSize = 0;

		this.images = new BufferCache();
		this.encoder = new QOI565Encoder();
		this.fontGen = new FontCodeGen(this);
	}

	/**
	 * 添加元素的截图作为图像(CG_ImageData)到代码中，若不存在，并返回变量名
	 * @param {import('selenium-webdriver').WebElement} element
	 * @param metadata
	 * @return {Promise<string>}
	 */
	async addImage(element, metadata) {
		let screenshot = await element.takeScreenshot();
		const buffer = Buffer.from(screenshot, 'base64');
		const qoiData = this.encoder.encodeImage(buffer, metadata);
		return this.computeIfImageAbsent(qoiData);
	}

	/**
	 * 添加元素的截图作为图像对象(CG_Image)到代码中，若不存在，并返回变量名
	 *
	 * @param {import('selenium-webdriver').WebElement} element
	 * @return {Promise<string>}
	 */
	async addCroppableImage(element) {
		const bufferData = {};
		let imageHash = await this.addImage(element, bufferData);
		const {width, height} = bufferData;
		const newName = imageHash.replace("CG_IMAGE_", "CG_IMAGE_OBJ_");

		const code = `const CG_Image `+newName+` = { ${imageHash}, ${width}, ${height} };\n`;
		this.code += code;
		this.dataSize += 8;
		return newName;
	}

	/**
	 * 添加图像对象(CG_Image)到代码中，若不存在，并返回变量名
	 *
	 * @param {Buffer|Uint8Array} buffer
	 * @param {number} width
	 * @param {number} height
	 * @return {string}
	 */
	addCroppableImage2(buffer, width, height) {
		const qoiData = Object.assign(this.encoder.encodeBuffer(buffer), {width, height});

		const imageHash = this.computeIfImageAbsent(qoiData);
		const newName = imageHash.replace("CG_IMAGE_", "CG_IMAGE_OBJ_");

		const code = `const CG_Image `+newName+` = { ${imageHash}, ${width}, ${height} };\n`;
		this.code += code;
		this.dataSize += 8;
		return newName;
	}

	/**
	 * 添加图像(CG_ImageData)到代码中，若不存在，并返回变量名
	 *
	 * @param {Buffer} qoiData
	 * @param {string} imageDescription
	 * @return {string}
	 */
	computeIfImageAbsent(qoiData, imageDescription='Image') {
		return this.images.computeIfAbsent(qoiData, (buffer, hash) => {
			if (DUMP_IMAGE) {
				const {width, height} = buffer;
				const decodeQoi = decodeImage(qoiData, width * height);
				const pngData = UPNG.encode([decodeQoi.buffer], width, height);
				fs.writeFileSync("./output/"+hash+".png", Buffer.from(pngData));
			}

			const variableName = `_CG_IMAGE_${hash}`;
			this.code += printBuffer(imageDescription, variableName, buffer);
			this.dataSize += buffer.length;
			return variableName;
		})
	}

	/**
	 * 渲染字符集并生成 C 语言 RGB565 位图数组
	 * @param {import('selenium-webdriver').WebDriver} driver Selenium驱动
	 * @param {import('selenium-webdriver').WebElement} element 目标DOM元素
	 * @param {string} alphabet 要生成的字符集 (例如: "0123456789")
	 * @param {string} fontName
	 * @returns {Promise<string>} 返回 C 语言数组定义字符串
	 */
	addFont(driver, element, metadata, screenName) {
		return this.fontGen.addFont(driver, element, metadata.alphabet, screenName+"_"+metadata.id);
	}

	// raw 2014   qoi 26   rate 1.291%
	// raw 1672   qoi 33   rate 1.974%
	// raw 1672   qoi 18   rate 1.077%
	/**
	 * 检测这个区域内是否为纯色
	 * 如果是：颜色填充
	 * 如果否：生成一个图像填充（通常只占用几十字节，如果没有纹理，而主要是抗锯齿）
	 *
	 * @param {CGUI.ImageBuffer2} image
	 * @param {number} left
	 * @param {number} top
	 * @param {number} width
	 * @param {number} height
	 * @return {string}
	 */
	_generateTextureFill(image, left, top, width, height) {
		const rgbaView = new Uint32Array(image.buffer.buffer);
		let color = null;
		for (let y = top; y < top + height; y++) {
			for (let x = left; x < left + width; x++) {
				let pixelOffset = y * image.width + x;
				const pixel = rgbaView[pixelOffset];
				if (color == null) color = pixel;
				else if (pixel !== color) {
					const childBuffer = new Uint32Array(width * height);
					for (let y1 = top; y1 < top + height; y1++) {
						for (let x1 = left; x1 < left + width; x1++) {
							let pixelOffset = y1 * image.width + x1;
							let newOffset = (y1-top) * width + x1-left;
							childBuffer[newOffset] = rgbaView[pixelOffset];
						}
					}

					this.hasTextureFill = true;
					return `(uintptr_t)&`+this.addCroppableImage2(new Uint8Array(childBuffer.buffer), width, height)
				}
			}
		}
		return "CG_Color(0x" + RGB32To565(color).toString(16) + ")";
	}

	/**
	 * @param {CGUI.Screen} screen
	 * @param {CGUI.ImageBuffer2} background
	 * @param {string} backgroundId
	 */
	generateScreenCode(screen, background, backgroundId) {
		const colorCheckMap = new BufferCache();

		const getBackground = ({left, top, width, height}) => {
			const hash = Buffer.alloc(16);
			hash.writeInt32LE(left, 0);
			hash.writeInt32LE(top, 4);
			hash.writeInt32LE(width, 8);
			hash.writeInt32LE(height, 12);

			return colorCheckMap.computeIfAbsent(hash, () => {
				return this._generateTextureFill(background, left, top, width, height);
			});
		}

		const screenName = screen.id;

		const dirtyMap = new Map;
		const userFunc = new Map;
		const struct = [];

		let funcs = '';
		let update = `void ${funcPrefix}${screenName}_Update(${funcPrefix}${screenName}_State *state) {\n`+screen.globalScript+'\n';
		let init = `void ${funcPrefix}${screenName}_Init(${funcPrefix}${screenName}_State *state) {\n`+screen.globalScript+'\n';

		init += `    CG_fillImage(${backgroundId}, 0, 0, ${screen.screenRect.width}, ${screen.screenRect.height});\n`;

		screen.allMetadata.forEach((item, index) => {
			if (!item.code) {
				if (item.type === "exit") {
					dirtyMap.set(Math.random(), {dataType: "exit", users: []});
				}
				console.warn("没有代码？", item);
				return;
			}

			const key = item.toString() + item.code;

			if (dirtyMap.has(key)) {
				const prevState = dirtyMap.get(key);
				if (!prevState.dataType && item.dataType) {
					prevState.dataType = item.dataType;
				} else if (item.dataType && prevState.dataType !== item.dataType) {
					throw new Error("同一段代码的数据类型冲突！"+prevState.dataType+", "+item.dataType+" on "+key);
				}

				prevState.users.push(index);
			} else {
				dirtyMap.set(key, {
					code: item.code,
					users: [index],
					dataType: item.dataType
				});
			}
		});

		let index = 0;

		for (const group of dirtyMap.values()) {
			if (group.dataType === "exit") {
				const blockTemplate = `\n    } //exit block #${group.id}\n`;
				init += blockTemplate;
				update += blockTemplate;
				continue;
			}

			struct.push({
				dataType: group.dataType,
				index
			});

			let ifNeedState = '';
			let func = `static void _CG_${screenName}_Update${index}(${group.dataType} newValue) {\n`;
			const requireState = () =>{
				if (ifNeedState) return;
				ifNeedState = `, state`;
				func = func.replace(")",  `, CG_${screenName}_State *state)`);
			};

			const renderString = (item, variables = "text, prev") => {
				const paddingType = (item.padding || 'left')[0].toUpperCase();
				switch (paddingType) {
					// Left
					default: {
						func += `    CG_fillTextLA(&${item.font}, ${item.left}, ${item.top}, ${variables}, ${getBackground(item)});\n`;
					}
						break;
					case "R": {
						func += `    CG_fillTextRA(&${item.font}, ${item.left + item.width}, ${item.top}, ${variables}, ${getBackground(item)});\n`;
					}
						break;
					case "C": {
						func += `    CG_fillTextCA(&${item.font}, ${item.left}, ${item.top}, ${item.width}, ${variables}, ${getBackground(item)});\n`;
					}
						break;
				}
				return func;
			};

			let isIfBlock = false;
			for (const i of group.users) {
				const item = screen.allMetadata[i];
				switch (item.type) {
					case "if": {
						requireState();
						func += `    if (state != NULL || newValue) CG_fillImage(newValue ? ${item.fullId} : ${item.emptyId}, ${item.left}, ${item.top}, ${item.width}, ${item.height});\n`;
						isIfBlock = true;
					}
					break;
					case "image": {
						func += `    ImageData image${i};\n    `;
						for (const key in item.images) {
							func += `if (newValue ${key.match(/==|!=|<|>|<=|>=/) ? key : "== "+key}) image${i} = ${item.images[key]};\n    else `;
						}
						func += `image${i} = ${item.orElseImage};\n    CG_fillImage(image${i}, ${item.left}, ${item.top}, ${item.width}, ${item.height});\n`;
					}
					break;
					case "fixed":
					case "number": {
						requireState();
						const len = Math.min(item.maxLength + 1, 13);
						func += `    char oldBuf[${len}];
    const char* prev = state == NULL ? "" : CG_decimalToString(&oldBuf[${len}], ${item.digits || -1}, state->v${index});
    char newBuf[${len}];
    const char* text = CG_decimalToString(&newBuf[${len}], ${item.digits || -1}, newValue);
`;
						renderString(item);
					}
					break;
					case "string": {
						requireState();
						// 自定义渲染器
						if (item.renderer) {
							let funcId = userFunc.get(item.renderer);
							if (!funcId) {
								funcId = `_CG_${screenName}_CustomRenderer_${index}`;
								funcs += `const char* ${funcId}(char* buf, ${item.dataType} val) {${item.renderer}}\n`;
								userFunc.set(item.renderer, funcId);
							}
							func += `    char oldBuf[${item.bufferSize}];
    const char* prev = state == NULL ? "" : ${funcId}(oldBuf, state->v${index});
    char newBuf[${item.bufferSize}];
    const char* text = ${funcId}(newBuf, newValue);
`;
							renderString(item);
						} else {
							renderString(item, `newValue, state == NULL ? "" : state->v${index}`);
						}
					}
					break;
					case "bar": {
						requireState();
						// TODO 检测纯色
						const DIR = item.direction.toUpperCase();
						func += `    if (state == NULL) {
        CG_fillProgressBar(${item.left}, ${item.top}, newValue, ${DIR === "top" || DIR === "bottom" ? item.height: item.width}, (uintptr_t)&${item.fullId}, (uintptr_t)&${item.emptyId}, CG_DIR_${DIR});
        CG_fillProgressBar(${item.left}, ${item.top}, newValue, 0, (uintptr_t)&${item.fullId}, (uintptr_t)&${item.emptyId}, CG_DIR_${DIR});
        
    } else
        CG_fillProgressBar(${item.left}, ${item.top}, newValue, state->v${index}, (uintptr_t)&${item.fullId}, (uintptr_t)&${item.emptyId}, CG_DIR_${DIR});
`;
					}
					break;
				}
			}
			funcs += func + "}\n";

			const code = group.code;
			update += `    ${group.dataType} v${index} = ${code};
    if (state->v${index} != v${index}) {
        _CG_${screenName}_Update${index}(v${index}${ifNeedState});
        state->v${index} = v${index};
    }
`;
			init += `    ${group.dataType} v${index} = ${code};
    state->v${index} = v${index};
    _CG_${screenName}_Update${index}(v${index}${ifNeedState?", NULL":""});
`;

			if (isIfBlock) {
				const blockTemplate = `    if(v${index}) { // enter block #${group.users}\n\n`;
				init += blockTemplate;
				update += blockTemplate;
			}

			index++;
		}

		let structStr = '';
		for (const {dataType, index} of struct.sort((a, b) => {
			return getRelativeDataSize(b.dataType) - getRelativeDataSize(a.dataType);
		})) {
			structStr += `\n    ${dataType} v${index};`;
		}

		this.renderedScreens.push({
			name: screenName,
			width: screen.screenRect.width,
			height: screen.screenRect.height,
			code: `
${funcs}
${update}}

${init}}
`
		});

		this.header += `
/**
 * @brief ${screenName} 状态结构
 * 包含所有 cg-bind 绑定的动态变量的上一次状态，用于增量重绘检测
 */
typedef struct {${structStr}
} CG_${screenName}_State;

/**
 * @brief 初始化界面
 * 渲染背景并设置初始状态
 */
${init.substring(0, init.indexOf('{') - 1)};

/**
 * @brief 增量更新界面
 * 扫描 state 中的变量变化，仅对发生改变的区域进行局部更新
 */
${update.substring(0, update.indexOf('{') - 1)};
`;
	}

	finish() {
		let width = this.renderedScreens[0].width;
		let height = this.renderedScreens[0].height;
		let widthStr = `// 渲染分辨率: ${width} x ${height}`;

		for (const value of this.renderedScreens) {
			if (value.width !== width || value.height !== height) {
				widthStr = '// 渲染分辨率: 变化';
				break;
			}
		}

		const {code, dataSize, hasGBKChar} = this.fontGen.generate();
		this.dataSize += dataSize;

		const creationTime = new Date().toLocaleString();
		this.code = `// =================================================================================
// 请勿编辑：程序自动生成
// CGUI 界面 ${this.renderedScreens.map(t => t.name).join(",")} 渲染函数和资源
${widthStr}
// ROM使用(约): ${this.dataSize} 字节
// 生成时间: ${creationTime}
// 由 CGUI 嵌入式界面构建工具生成: https://github.com/roj234/cgui
// =================================================================================
#include "cgui_${this.fileName}.h"

// 1. 图像数据: QOI565 Images
${this.code}
// 2. 字体数据: SharedFontPool / [SortedFontMap | IndexedFontMap] / FontData
${code}
// 3. 界面更新代码: Updater / CustomRenderer / Init / Update
`;

		for (const value of this.renderedScreens) {
			this.code += `\n// 界面 [${value.name}] ${value.width} x ${value.height}`+value.code;
		}

		let header = `// =================================================================================
// 请勿编辑：程序自动生成
// CGUI 界面 ${this.renderedScreens.map(t => t.name).join(",")} 结构定义
${widthStr}
// ROM使用(约): ${this.dataSize} 字节
// 生成时间: ${creationTime}
// 由 CGUI 嵌入式界面构建工具生成: https://github.com/roj234/cgui
// =================================================================================

#ifndef _CG_${this.fileName.toUpperCase()}_H
#define _CG_${this.fileName.toUpperCase()}_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

`;
		if (this.hasTextureFill) header += "#define CG_TEXTURE_FILL\n";
		if (hasGBKChar) header += "#define CG_GBK\n";
		header += "#define CG_Compression_QOI_Used\n";

		this.header = header + this.header + `
#ifdef __cplusplus
}
#endif

#endif // _CG_${this.fileName.toUpperCase()}_H
`;
	}
}
