
export const funcPrefix = "CG_";

export function printBuffer(desc, name, buffer) {
	let code = `/* ${desc}, Size: ${buffer.length} bytes */\n`;
	code += `static const uint8_t ${name}[] = {`;

	let line = '';
	for (let i = 0; i < buffer.length; i ++) {
		if (line.length >= 80) {
			code += '\n'+line;
			line = "";
		}
		line += buffer.readUInt8(i)+',';
	}
	if (line) code += '\n'+line;

	return code + "\n};\n";
}

export class LazyPromise {
	constructor() {
		this.promises = [];
	}

	add(promise) {
		this.promises.push(typeof promise === "function" ? promise() : promise);
	}
	async waitAll() {
		for (const promise of this.promises) {
			await promise;
		}
		this.promises = [];
	}
}

const dataMap = {};
(function(s) {
	let lvl = 0;
	for (let level of s.trim().split("\n")) {
		for (let type of level.split(" ")) {
			dataMap[type.trim()] = lvl;
		}
		lvl++;
	}
})(`
uint8_t int8_t bool char
uint16_t int16_t int
uint32_t int32_t
uint64_t int64_t
`);
export function getRelativeDataSize(dataType) {
	if (dataType.endsWith("*")) return 4;
	return dataMap[dataType];
}

/**
 * 截取 Uint32Array 格式的 RGBA 图像数据
 *
 * @param {Uint32Array} sourceArray - 原始图像数据
 * @param {number} sourceWidth - 原始图像宽度
 * @param {number} sourceHeight - 原始图像高度
 * @param {number} x - 起始截取位置 X
 * @param {number} y - 起始截取位置 Y
 * @param {number} targetWidth - 截取的宽度
 * @param {number} targetHeight - 截取的高度
 * @returns {Uint32Array} - 截取后的新数组
 */
export function cropUint32Array(sourceArray, sourceWidth, sourceHeight, x, y, targetWidth, targetHeight) {
	// 1. 创建目标数组
	const result = new Uint32Array(targetWidth * targetHeight);

	// 2. 边界检查与修正（防止越界导致程序崩溃或 OOM）
	const safeX = Math.max(0, Math.min(x, sourceWidth));
	const safeY = Math.max(0, Math.min(y, sourceHeight));
	const actualWidth = Math.min(targetWidth, sourceWidth - safeX);
	const actualHeight = Math.min(targetHeight, sourceHeight - safeY);

	// 3. 逐行拷贝数据
	for (let i = 0; i < actualHeight; i++) {
		// 计算原始数组中当前行的起始索引
		// 索引公式: $index = (y + i) * sourceWidth + x$
		const sourceStart = (safeY + i) * sourceWidth + safeX;
		const sourceEnd = sourceStart + actualWidth;

		// 获取源数组的切片视图（subarray 不产生内存拷贝）
		const rowData = sourceArray.subarray(sourceStart, sourceEnd);

		// 将切片写入目标数组的对应位置
		// 目标起始索引: $i * targetWidth$
		result.set(rowData, i * targetWidth);
	}

	return result;
}