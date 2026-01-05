/**
 * build.js: CGUI Build entry
 * Roj234 &copy; 2026
 * Last Modified: 2026/01/05
 */

import {Builder} from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import fs from 'fs';
import {LazyPromise, printBuffer} from "./utils.js";
import {CodeGen} from "./codegen.js";
import {pathToFileURL} from 'url';
import path from 'path';
import {CodeGenTabs} from "./codegen_tabs.js";
import GBK from "gbk.js";
import {QOI565Encoder} from "./qoi.js";

/**
 *
 * @param {CodeGen} codeGen
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {CGUI.Screen} screen
 * @return {Promise<void>}
 */
async function renderSingleScreen(codeGen, driver, screen) {
	const lazyPromise = new LazyPromise();

	const background = {};
	const backgroundId = await codeGen.addImage(screen.screen, background);
	await driver.executeScript("arguments[0].classList.remove('cg-render')", screen.screen);

	for (let metadata of screen.allMetadata) {
		const node = screen.allElements[metadata.id];

		switch (metadata.type) {
			case "image":
				const images = {};

				lazyPromise.add(async () => {
					metadata.orElseImage = await codeGen.addImage(node);
				});

				let prevState = [];
				for (const key in metadata.condition) {
					lazyPromise.add(async () => {
						await driver.executeScript(`
const el = arguments[0];
el.classList.remove(...arguments[1]);
el.classList.add(...arguments[2]);
`, node, prevState, prevState = metadata.condition[key]);

						images[key] = await codeGen.addImage(node);
					});
				}

				metadata.images = images;
				break;
			case "if": {
				// TODO 嵌套的if如何正确异步渲染？
				lazyPromise.add(async () => {
					await driver.executeScript("arguments[0].classList.add('cg-render')", node);
					const bufferInfo = {};
					metadata.fullId = await codeGen.addImage(node, bufferInfo);
					metadata.image = bufferInfo;
					await driver.executeScript("arguments[0].classList.add('hide')", node);
					metadata.emptyId = await codeGen.addImage(node);
					await driver.executeScript("arguments[0].classList.remove('hide', 'cg-render')", node);
				});
			}
				break;
			case "bar": {
				lazyPromise.add(async () => {
					await driver.executeScript("arguments[0].children[0].style.width = '0';", node);
					metadata.emptyId = await codeGen.addCroppableImage(node);
					await driver.executeScript("arguments[0].children[0].style.width = '100%';", node);
					metadata.fullId = await codeGen.addCroppableImage(node);
				});
			}
				break;
		}

		// TODO hbar/vbar
		if (metadata.type === "scrollable") {

		}
	}

	// 先处理背景，再渲染字体
	await lazyPromise.waitAll();

	for (let metadata of screen.allMetadata) {
		if (metadata.alphabet) {
			const node = screen.allElements[metadata.id];

			lazyPromise.add(async () => {
				metadata.font = await codeGen.addFont(driver, node, metadata, screen.id);
			})
		}
	}

	// 等待字体渲染完成
	await lazyPromise.waitAll();

	codeGen.generateScreenCode(screen, background, backgroundId);
}

async function extractUI(url) {
	const startTime = Date.now();
	let options = new chrome.Options();
	options.addArguments("--headless=new");
	options.addArguments("--disable-software-rasterizer");
	options.addArguments("--no-sandbox");
	options.addArguments("--disable-dev-shm-usage");
	options.addArguments("--enable-low-end-device-mode");
	options.addArguments("--force-device-scale-factor=1");
	options.addArguments("--high-dpi-support=0");
	// 如果找不到 Chrome，可以手动指定你的 Chrome 路径：
	// options.setChromeBinaryPath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');

	/**
	 *
	 * @type {import('selenium-webdriver').WebDriver}
	 */
	let driver = await new Builder()
		.forBrowser('chrome')
		.setChromeOptions(options)
		.build();

	try {
		console.log("Accessing", url);
		await driver.get(url);

		/**
		 * @type {Record<string, CGUI.Screen>}
		 */
		const guiState = await driver.executeScript("return window.CGUI_State");

		const bootTime = Date.now();

		let path1 = URL.parse(url).pathname;
		if (path1.endsWith("/index.html")) path1 = path1.replace("/index.html", "");
		if (path1.endsWith(".html")) path1 = path1.replace(".html", "");

		const codeGen = new CodeGen(path.basename(path1));

		for (const key in guiState) {
			await renderSingleScreen(codeGen, driver, guiState[key]);
		}

		codeGen.finish();

		console.log("Approx. DATA usage (not incl. CODE)", codeGen.dataSize, "bytes");

		const yosTabs = CodeGenTabs(Object.keys(guiState), 60);

		// GBK?
		fs.writeFileSync(`./dist/cgui_${codeGen.fileName}.h`, Buffer.from(GBK.encode(codeGen.header + yosTabs.header)));
		fs.writeFileSync(`./dist/cgui_${codeGen.fileName}.c`, Buffer.from(GBK.encode(codeGen.code + yosTabs.code)));

		const endTime = Date.now();
		console.log("Total time", endTime - startTime, "ms, build time", endTime - bootTime, "ms");
	} finally {
		await driver.quit();
	}
}

const htmlPath = path.resolve(process.argv[2] || `index.html`);
if (!fs.existsSync(htmlPath)) {
	throw new Error(`HTML文件 ${htmlPath} 不存在！`);
}
if (htmlPath.endsWith(".png")) {
	const qoiImage = new QOI565Encoder().encodeImage(fs.readFileSync(htmlPath));
	console.log(printBuffer("QOI Image " + htmlPath, "IMAGE_SOME", qoiImage));
	exit();
}
if (!fs.existsSync("dist"))
	fs.mkdirSync("dist");

extractUI(pathToFileURL(htmlPath).href);
