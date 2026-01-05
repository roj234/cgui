
import {BufferCache} from "./cache.js";
import {printBuffer} from "./utils.js";
import GBK from "gbk.js";

class FontPool {
	constructor() {
		this.aliases = new Map;
		this.hashes = new Map;
		this.pools = {};
		this.MAX_SIZE = 65536; // 64KB
	}

	/**
	 * 添加位图到指定用户的池中
	 * @param {Buffer} buffer 位图原始数据
	 * @param {string} fontName 字体名称
	 * @param {string} char 字符
	 * @returns {{pool: string, offset: number, prevDelta?: number}}
	 */
	addImage(buffer, fontName, char) {
		while(this.aliases.has(fontName))
			fontName = this.aliases.get(fontName);

		// 确保池存在
		if (!this.pools[fontName]) {
			this.pools[fontName] = {
				name: `CG_FontData_${fontName}`,
				cache: new BufferCache(),
				buffers: [],
				size: 0,
			};
		}

		const pool = this.pools[fontName];

		return pool.cache.computeIfAbsent(buffer, (buffer, hash) => {
			if (char !== ' ') {
				let existingFontPool = this.hashes.get(hash);
				if (existingFontPool) {
					while(this.aliases.has(existingFontPool))
						existingFontPool = this.aliases.get(existingFontPool);

					// 相同基本可以确定是同一个字体啊，就算全写完GBK也就几百KB，我感觉不大可能超过，直接合并吧
					if (fontName !== existingFontPool) {
						this.aliases.set(fontName, existingFontPool);
						delete this.pools[fontName];

						const otherPool = this.pools[existingFontPool];
						const otherMap = otherPool.cache.cache;

						const originalSize = otherPool.size;
						for (const [k, v] of pool.cache.cache.entries()) {
							v.offset += originalSize;
							v.pool = existingFontPool;
							otherMap.set(k, v);
						}

						otherPool.size += pool.size;
						otherPool.buffers.push(...pool.buffers);

						return {
							...otherMap.get(hash),
							prevDelta: originalSize
						};
					}

				} else {
					this.hashes.set(hash, fontName);
				}
			}

			const offset = pool.size;
			pool.size += buffer.length;
			pool.buffers.push(buffer);
			if (pool.size > this.MAX_SIZE) {
				console.warn(`[WARNING] Pool "${fontName}" length (${pool.size}) exceeds 64KB limit! 16-bit offset will overflow.`);
			}

			return {
				pool: pool.name,
				offset: offset
			};
		});
	}

	generateCode() {
		let code = ``;
		let length = 0;
		for (const [font, pool] of Object.entries(this.pools)) {
			const fullBuffer = Buffer.concat(pool.buffers);
			length += fullBuffer.length;
			code += printBuffer("IndexedFontPool "+font, pool.name, fullBuffer);
		}

		return {
			code,
			length
		};
	}
}

/**
 * 内部辅助函数：生成 C 语言结构体数组字符串
 * @param {string} name 变量名
 * @param {Array} data 数据数组
 * @param {string} type 字符类型 'ASCII' | 'GBK'
 * @param {Object} options 选项 { monospace, strategy, minChar }
 */
function generateColorFontData(name, data, type, { monospace, strategy, minChar }) {
	const isASCII = type === 'ASCII';
	const isLinear = strategy === 'LINEAR';

	// 定义结构体类型
	// 如果是等宽且是线性查找，只需存指针；否则需要存 code 或 width
	let structType;
	let structSize;
	if (isLinear) {
		structType = monospace ? "uint16_t" : "struct { uint16_t offset; uint8_t width; }";
	} else {
		const codeType = isASCII ? "uint8_t" : "uint16_t";
		structType = monospace
			? `struct { uint16_t offset; ${codeType} code; }`
			: `struct { uint16_t offset; ${codeType} code; uint8_t width; }`;
	}

	let entries = [];

	if (isLinear && isASCII) {
		// 线性查找表生成逻辑：构造一个包含空隙的连续数组
		const maxChar = data[data.length - 1].char.charCodeAt(0);
		const range = maxChar - minChar + 1;
		const lookup = new Array(range).fill(null);

		data.forEach(item => {
			lookup[item.char.charCodeAt(0) - minChar] = item;
		});

		structSize = range * 4;
		for (let i = 0; i < range; i++) {
			const item = lookup[i];
			if (!item) {
				entries.push(monospace ? "CG_FontData_Undef" : "{ CG_FontData_Undef, 0 }");
			} else {
				entries.push(monospace ? item.offset : `{ ${item.offset}, ${item.width} }`);
			}
		}
	} else {
		structSize = data.length * (isASCII ? 4 : 6);
		// 二分搜索或 GBK：直接映射现有数据
		data.forEach(item => {
			const codeStr = isASCII
				? `'${item.char === "'" ? "\\'" : item.char}'`
				: `0x${item.code.toString(16).toUpperCase()}`;

			if (monospace) {
				entries.push(`{ ${item.offset}, ${codeStr} }`);
			} else {
				entries.push(`{ ${item.offset}, ${codeStr}, ${item.width} }`);
			}
		});
	}

	return {
		header: `static const ${structType} ${name}[] = {\n    ${entries.join(",\n    ")}\n};\n`,
		structSize
	};
}

/**
 * 判断是否值得采用查找表（线性直接索引）而不是二分搜索
 * @param {string} str - 已经按ASCII排序后的字符串
 * @returns {string} 决策和
 */
function evaluateSearchStrategy(str) {
	if (!str) return "LINEAR";

	const n = str.length;
	const minChar = str.charCodeAt(0);
	const maxChar = str.charCodeAt(n - 1);

	// 计算范围和空隙
	const range = maxChar - minChar + 1;
	const gaps = range - n;

	/**
	 * 根据用户提供的权重计算成本:
	 * 二分搜索：每个字符额外占用2字节 (对齐)
	 * 查找表：每个空隙占用4字节 (指针/偏移量)
	 */
	const binarySearchMemoryCost = n * 2;
	const linearSearchMemoryCost = gaps * 4;

	// 性能阈值：如果查找表不仅快，而且内存增加在可接受范围内
	// 或者内存甚至更小，则推荐线性查找表
	const isWorthyByMemory = linearSearchMemoryCost <= binarySearchMemoryCost;

	// 即使内存稍多，如果范围极小（例如 < 16），O(1) 的优势也非常巨大
	const isWorthyBySpeed = range < 16;

	return (isWorthyByMemory || isWorthyBySpeed) ? "LINEAR" : "BIN";
}

export class FontCodeGen {
	constructor(codeGen) {
		this.encoder = codeGen.encoder;
		this.fileName = codeGen.fileName;

		this.fonts = new Map;
		this.texturePool = new FontPool();
	}

	/**
	 * 渲染字符集并生成 C 语言 RGB565 位图数组
	 * @param {import('selenium-webdriver').WebDriver} driver Selenium驱动
	 * @param {import('selenium-webdriver').WebElement} element 目标DOM元素
	 * @param {string} alphabet 要生成的字符集 (例如: "0123456789")
	 * @param {string} fontName
	 * @returns {Promise<string>} 返回 C 语言数组定义字符串
	 */
	async addFont(driver, element, alphabet, fontName) {
		const slot = {};
		for(const c of alphabet) {
			const arr = GBK.encode(c);
			slot[c] = (arr[1] << 16) | arr[0];
		}
		const chars = Object.keys(slot).sort((a, b) => (slot[a] - slot[b])).join("");

		let fontDataASC = [];
		let fontData = fontDataASC;
		let fontDataGBK = [];
		let initWidth = 0, initHeight = 0;
		let monospace = true;

		let fontPoolId = 'NULL';

		for (let i = 0; i < chars.length; i++) {
			const char = chars[i];
			const isGBK = char.charCodeAt(0) > 255;
			if (isGBK) fontData = fontDataGBK;

			const rect = await driver.executeScript("arguments[0].innerText = arguments[1];return arguments[0].getBoundingClientRect();", element, char);

			//const rect = await element.getRect();
			const width = Math.round(rect.width * (isGBK ? 0.5 : 1));
			const height = Math.round(rect.height);
			if (!initWidth) {
				initWidth = width;
				initHeight = height;
			} else {
				if (initWidth !== width) monospace = false;
				if (initHeight !== height) throw new Error("渲染高度不统一，请手动固定元素"+fontName+"的高度");
			}

			let screenshot = await element.takeScreenshot();
			const buffer = Buffer.from(screenshot, 'base64');
			const qoiData = this.encoder.encodeImage(buffer);
			const fontPoolInfo = this.texturePool.addImage(qoiData, fontName, char);

			fontPoolId = fontPoolInfo.pool;
			if (fontPoolInfo.prevDelta) {
				for (const el of fontDataASC) {
					el.offset += fontPoolInfo.prevDelta;
				}
				for (const el of fontDataGBK) {
					el.offset += fontPoolInfo.prevDelta;
				}
			}

			fontData.push({ char, offset: fontPoolInfo.offset, width, code: slot[char] });
		}

		const fontMetaHash = initWidth+"|"+initHeight+"|"+monospace+"|"+fontPoolId;
		const fontMetrics = [];
		for (const el of fontDataASC) fontMetrics.push(el.offset);
		for (const el of fontDataGBK) fontMetrics.push(el.offset);

		const existingFont = this._findExistingFont(fontMetaHash, fontMetrics);
		if (existingFont) return existingFont.fontId;

		// 3. 策略评估
		const asciiStrategy = evaluateSearchStrategy(chars.substring(0, fontDataASC.length));
		const minAsciiChar = fontDataASC.length ? fontDataASC[0].char.charCodeAt(0) : 0;

		const fontId = `_CG_${this.fileName}_Font`+fontName;
		let fontCode = `// 字体位图数据 ${fontName} [${alphabet}]\n`;
		let structSize1 = 0;

		if (fontDataASC.length) {
			const {header, structSize} = generateColorFontData(`${fontId}_MAP_ASCII`, fontDataASC, 'ASCII', {
				monospace,
				strategy: asciiStrategy,
				minChar: minAsciiChar
			})
			fontCode += header;
			structSize1 += structSize;
		}

		if (fontDataGBK.length) {
			this.hasGBKChar = true;
			const {header, structSize} = generateColorFontData(`${fontId}_MAP_GBK`, fontDataGBK, 'GBK', {
				monospace,
				strategy: 'BIN'
			});
			fontCode += header;
			structSize1 += structSize;
		}

		const generatedFontData = {
			fontId,
			metrics: fontMetrics,
			strategy: asciiStrategy,
			alphabet: chars,
			size: structSize1+19,
			code: fontCode+`static const CG_Font ${fontId} = {
    .ascii_map = (pointer)${fontDataASC.length ? `${fontId}_MAP_ASCII` : "NULL"},
    .ascii_cnt = ${asciiStrategy === "LINEAR" ? (fontDataASC[fontDataASC.length-1].char.charCodeAt(0) - minAsciiChar + 1) : fontDataASC.length},
    .ascii_offset = ${asciiStrategy === "LINEAR" ? minAsciiChar : 0},

    .gbk_map = (pointer)${fontDataGBK.length ? `${fontId}_MAP_GBK` : "NULL"},
    .gbk_cnt = ${fontDataGBK.length},

    .pool = (pointer)${fontPoolId},

    .width = ${monospace ? initWidth : 0},
    .height = ${initHeight},

    .compression = CG_Compression_QOI
};\n`
		}

		const arr = this.fonts.get(fontMetaHash);
		if (!arr) this.fonts.set(fontMetaHash, [generatedFontData]);
		else {
			this._updateFontAliasing(fontMetaHash, fontMetrics, generatedFontData);
			arr.push(generatedFontData);
		}

		return fontId;
	}

	generate() {
		let {code, length} = this.texturePool.generateCode();

		for (const fonts of this.fonts.values()) {
			for (const font of fonts) {
				code += font.code;
				length += font.size;
			}
		}

		return { code, dataSize: length, hasGBKChar: !!this.hasGBKChar };
	}

	_findExistingFont(fontMetaHash, fontMetrics) {
		const fonts = this.fonts.get(fontMetaHash);
		if (!fonts) return null;

		for (const font of fonts) {
			let remaining = new Set(fontMetrics);
			for (const offset of font.metrics) {
				remaining.delete(offset);
				if (!remaining.size) return font;
			}
		}
		return null;
	}

	_updateFontAliasing(fontMetaHash, fontMetrics, thisFont) {
		const fonts = this.fonts.get(fontMetaHash);

		for (const font of fonts) {
			let remaining = new Set(font.metrics);
			for (const offset of fontMetrics) {
				remaining.delete(offset);

				// 性能相同或更好
				if (!remaining.size && (thisFont.strategy === 'BIN' || font.strategy === 'LINEAR')) {
					font.code = `#define ${font.fontId} ${thisFont.fontId}\n`;
					console.log("合并字体子集", font.fontId, "=>", thisFont.fontId);
					font.size = 0;
				}
			}
		}
	}
}