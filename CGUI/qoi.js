import UPNG from 'upng-js';

// --- QOI5551 编码器实现 ---
export class QOI565Encoder {
    constructor() {
        this.hashTable = new Int32Array(64);
    }

    /**
     *
     * @param {Buffer<ArrayBuffer>|Uint8Array} pngData
     * @param {{}} keepMeta=
     * @return {Buffer<ArrayBuffer>}
     */
    encodeImage(pngData, keepMeta) {
        const info = UPNG.decode(pngData);
        let {width, height, depth, ctype, data, frames} = info;
        if (depth !== 8 || ctype !== 6 || frames.length) {
            data = new Uint8Array(UPNG.toRGBA8(info)[0]);
        } else if (data.length !== width * height * 4) {
            // remove trailers
            data = data.slice(0, width*height * 4);
        }

        if (keepMeta) Object.assign(keepMeta, {width, height, buffer: data});

        return Object.assign(this.encodeBuffer(data), { width, height });
    }

    /**
     *
     * @param {Uint8Array|Buffer} data
     * @return {Buffer<ArrayBuffer>}
     */
    encodeBuffer(data) {
        if (!data.length || (data.length & 3) !== 0) throw new Error("Buffer size must be a multiple of 4, got"+data.length);
        const out = new Uint8Array(data.length); // 存储字节流
        this.hashTable.fill(0);

        let prev = 0xFF000000 >>> 0; // 无符号处理
        const pixels = data.length / 4;
        let outIdx = 0;

        for (let i = 0; i < pixels; ) {
            // 读取当前像素为 ARGB (与 Java 逻辑一致)
            const r8 = data[i * 4];
            const g8 = data[i * 4 + 1];
            const b8 = data[i * 4 + 2];
            const a8 = data[i * 4 + 3];
            const pixel = ((a8 << 24) | (r8 << 16) | (g8 << 8) | b8) >>> 0;

            // 1. Run length encode (QOI_OP_RUN)
            if (pixel === prev) {
                let run = 0;
                i++;
                while (i < pixels && (
                    ((data[i*4+3] << 24) | (data[i*4] << 16) | (data[i*4+1] << 8) | data[i*4+2]) >>> 0
                ) === pixel && run < 61) {
                    run++;
                    i++;
                }
                out[outIdx++] = (0b11000000 | run);
                continue;
            }

            // 2. 透明处理 (Java 里的 0b11111111 marker)
            if ((pixel >>> 24) !== 0xFF) {
                out[outIdx++] = (0xFF);
                prev = pixel;
                i++;
                continue;
            }

            // 提取 565 分量进行 Hash 和 Diff 计算
            const r = (pixel >>> 19) & 31;
            const g = (pixel >>> 10) & 63;
            const b = (pixel >>> 3) & 31;

            const idx = (r * 3 + g * 5 + b * 7) & 63;

            // 3. Index encode (QOI_OP_INDEX)
            encodedData:
            if (this.hashTable[idx] === pixel) {
                out[outIdx++] = (idx);
            } else {
                this.hashTable[idx] = pixel;

                const pr = (prev >>> 19) & 31;
                const pg = (prev >>> 10) & 63;
                const pb = (prev >>> 3) & 31;

                const dr = r - pr;
                const dg = g - pg;
                const db = b - pb;

                // 4. QOI_OP_DIFF (RGB delta in [-2, 1])
                if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
                    out[outIdx++] = (0b01000000 | (dr + 2) << 4 | (dg + 2) << 2 | (db + 2));
                    break encodedData;
                }
                // 5. QOI_OP_LUMA (G delta in [-32, 31], R/B relative to G in [-8, 7])
                else if (dg > -33 && dg < 32) {
                    const dr_dg = dr - dg;
                    const db_dg = db - dg;
                    if (dr_dg >= -8 && dr_dg <= 7 && db_dg >= -8 && db_dg <= 7) {
                        out[outIdx++] = (0b10000000 | (dg + 32));
                        out[outIdx++] = ((dr_dg + 8) << 4 | (db_dg + 8));
                        break encodedData;
                    }
                }

                const rgb565 = RGB32To565(pixel);
                out[outIdx++] = (0b11111110);
                out[outIdx++] = ((rgb565 >> 8) & 0xFF);
                out[outIdx++] = (rgb565 & 0xFF);
            }

            prev = pixel;
            i++;
        }

        if (outIdx >= data.length/3) {
            console.log("BADLY COMPRESSION: raw", data.length/2, "\tqoi", outIdx, "\trate", ((outIdx/(data.length/2))*100).toFixed(3)+"%");
        }
        return Buffer.from(out.slice(0, outIdx));
    }
}

export function RGB32To565(pixel) {
    const r = (pixel >>> 19) & 31;
    const g = (pixel >>> 10) & 63;
    const b = (pixel >>> 3) & 31;
    return (r << 11) | (g << 5) | b;
}

/**
 * 解码图片数据至 RGB8888 Buffer
 *
 * @param {Buffer} input - 压缩的二进制数据
 * @param {number} pixelCount - 像素总数
 * @returns {Uint8Array} 解码后的 32-bit 数据流
 */
export function decodeImage(input, pixelCount) {
    // 每个像素 2 字节 (RGB565)
    const out = new Uint8Array(pixelCount * 4);
    let outOffset = 0;
    let inOffset = 0;

    let r = 0, g = 0, b = 0, a = 0;
    // 64个条目的查找表，每个条目存 r, g, b
    const tab = new Uint8Array(64 * 3);

    let remainingPixels = pixelCount;

    while (remainingPixels > 0 && inOffset < input.length) {
        let b1 = input[inOffset++];
        let type = b1 >> 6;

        switch (type) {
            case 0: { // INDEX: 从查找表获取
                let idx = (b1 & 0x3F) * 3;
                r = tab[idx];
                g = tab[idx + 1];
                b = tab[idx + 2];
                a = 0xFF;
                break;
            }
            case 1: { // DIFF: 较小的差值数值
                r = (r + ((b1 >> 4) & 3) - 2) & 0x1F;
                g = (g + ((b1 >> 2) & 3) - 2) & 0x3F;
                b = (b + (b1 & 3) - 2) & 0x1F;
                a = 0xFF;
                break;
            }
            case 2: { // LUMA: 基于亮度的差值
                let b2 = input[inOffset++];
                let vg = (b1 & 0x3F) - 32;
                r = (r + vg - 8 + ((b2 >> 4) & 0x0F)) & 0x1F;
                g = (g + vg) & 0x3F;
                b = (b + vg - 8 + (b2 & 0x0F)) & 0x1F;
                a = 0xFF;
                break;
            }
            case 3: { // 扩展指令 (RLE, RGB, Transparent)
                if (b1 >= 254) {
                    if (b1 === 255) { // TRANSPARENT
                        a = 0;
                    } else { // RAW RGB
                        let tmp = (input[inOffset++] << 8) | input[inOffset++];
                        r = (tmp >> 11) & 31;
                        g = (tmp >> 5) & 63;
                        b = tmp & 31;
                        a = 0xFF;
                    }
                } else { // RLE: 重复运行长度
                    let repeatCount = (b1 & 0x3F) + 1;

                    // 填充 Buffer
                    for (let i = 0; i < repeatCount && remainingPixels > 0; i++) {
                        out[outOffset++] = (r << 3);
                        out[outOffset++] = (g << 2);
                        out[outOffset++] = (b << 3);
                        out[outOffset++] = (a);
                        remainingPixels--;
                    }
                    continue;
                }
                break;
            }
        }

        // 更新查找表
        const h = (((r * 3) + (g * 5) + (b * 7)) & 63) * 3;
        tab[h] = r;
        tab[h + 1] = g;
        tab[h + 2] = b;

        out[outOffset++] = (r << 3);
        out[outOffset++] = (g << 2);
        out[outOffset++] = (b << 3);
        out[outOffset++] = (a);
        remainingPixels--;
    }

    return out;
}
