/**
 * PackBits 压缩
 * @param {Uint8Array} data - 原始单色位图字节数组
 * @returns {Uint8Array} - 压缩后的数据
 */
export function packbitsCompress(data) {
	const output = [];
	let i = 0;

	while (i < data.length) {
		// 尝试寻找重复序列
		let runLen = 1;
		while (runLen < 128 && i + runLen < data.length && data[i] === data[i + runLen]) {
			runLen++;
		}

		if (runLen > 1) {
			// 写入重复块：header 为 (1 - runLen)
			// 在 Uint8 中，-1 为 255, -127 为 129
			output.push(257 - runLen);
			output.push(data[i]);
			i += runLen;
		} else {
			// 寻找字面量长度（即不重复的长度）
			let literalLen = 0;
			while (literalLen < 128 && i + literalLen < data.length) {
				// 检查是否从此处开始了重复序列（至少连续3个才值得切换，如果是2个，PackBits 依然推荐用 Literal）
				if (i + literalLen + 1 < data.length &&
					data[i + literalLen] === data[i + literalLen + 1] &&
					(i + literalLen + 2 < data.length && data[i + literalLen] === data[i + literalLen + 2])) {
					break;
				}
				literalLen++;
			}

			// 写入字面量块：header 为 (literalLen - 1)
			output.push(literalLen - 1);
			for (let j = 0; j < literalLen; j++) {
				output.push(data[i + j]);
			}
			i += literalLen;
		}
	}

	return new Uint8Array(output);
}

/**
 * PackBits 解压
 * @param {Uint8Array} input - 压缩后的数据
 * @returns {Uint8Array} - 解压后的原始数据
 */
export function packbitsDecompress(input) {
	const output = [];
	let i = 0;

	while (i < input.length) {
		let header = input[i++];

		// 将无符号字节转为有符号 8 位整数
		if (header > 127) header -= 256;

		if (header >= 0 && header <= 127) {
			// 字面量：拷贝接下来的 n + 1 个字节
			let count = header + 1;
			for (let j = 0; j < count; j++) {
				output.push(input[i++]);
			}
		} else if (header >= -127 && header <= -1) {
			// 重复：重复接下来的 1 个字节 -n + 1 次
			let count = -header + 1;
			let value = input[i++];
			for (let j = 0; j < count; j++) {
				output.push(value);
			}
		}
		// header == -128 时忽略 (NOP)
	}

	return new Uint8Array(output);
}

// --- 测试 ---
const original = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0xFF, 0xAA, 0xBB, 0xBB, 0xBB]);
const compressed = packbitsCompress(original);
const decompressed = packbitsDecompress(compressed);

console.log("原始长度:", original.length);
console.log("压缩后:", compressed);
console.log("还原后:", decompressed);