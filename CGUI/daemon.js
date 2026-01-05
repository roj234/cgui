/**
 * daemon.js: CGUI Browser Daemon
 * Roj234 &copy; 2026
 */

function findElements(parent, selector, context) {
	for (const child of parent.children) {
		context.push();

		if (child.matches(selector)) {
			context.add(child);
		}

		findElements(child, selector, context);

		context.pop();
	}
}

function getRelativeOffset(child, parentRect) {
	const childRect = child.getBoundingClientRect();

	return {
		top: Math.round(childRect.top - parentRect.top),
		left: Math.round(childRect.left - parentRect.left),
		width: Math.round(childRect.width),
		height: Math.round(childRect.height)
	};
}

function resolveCode(code, metadata) {
	if (code?.startsWith('#')) {
		const el = document.querySelector(code);
		if (metadata) metadata.bufferSize = el.getAttribute("cg-buffersize");
		return el.textContent;
	}
	return code;
}

/**
 * @type {CGUI.Screen}
 */
class CGUIScreen {
	constructor(screen) {
		this.stack = [];
		this.root = {};
		this.active = this.root;

		this.id = screen.id;
		this.screen = screen;
		this.screenRect = screen.getBoundingClientRect();

		this.allElements = [];
		this.allMetadata = [];
		this.globalScript = '';
	}

	add(node) {
		const metadata = getRelativeOffset(node, this.screenRect);

		let dataType = node.getAttribute('cg-datatype');
		let alphabet = node.getAttribute('cg-alphabet');
		let padding = node.getAttribute('cg-padding');
		metadata.code = resolveCode(node.getAttribute('cg-bind'));

		if (node.matches(".cg-code")) {
			this.globalScript += node.textContent.trim()+"\n";
			return;
		}

		if (node.matches(".cg-string")) {
			if (!dataType) dataType = 'char*';

			metadata.type = "string";
			metadata.maxLength = node.innerText.length;
			if (!alphabet) alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
			metadata.alphabet = alphabet;
			metadata.padding = padding;
			metadata.renderer = resolveCode(node.getAttribute("cg-renderer"), metadata);

		}
		if (node.matches(".cg-number")) {
			if (!dataType) dataType = 'int32_t';

			const isFixedPoint = node.innerText.indexOf(".");
			if (!alphabet) {
				alphabet = "0123456789";
				if (isFixedPoint >= 0) alphabet += ".";
				if (!dataType.startsWith("u")) alphabet += "-";
			}
			metadata.type = isFixedPoint >= 0 ? "fixed" : "number";
			metadata.maxLength = node.innerText.length;
			// 小数位数
			if (isFixedPoint >= 0) metadata.digits = metadata.maxLength - isFixedPoint - 1;
			metadata.alphabet = alphabet;
			metadata.padding = padding;
		}

		if (node.matches(".cg-group")) {
			if (!dataType) dataType = 'bool';
			metadata.type = "if";
			metadata.cascading = true;
		}

		if (node.matches(".cg-image")) {
			metadata.type = "image";
			const condition = metadata.condition = {};

			for (const attr of node.attributes) {
				if (attr.name.startsWith("cg-if-")) {
					const kv = attr.value.split("|", 2);
					condition[kv[0]] = kv[1].split(" ");
				} else if (attr.name === "cg-else") {
					metadata.orElse = attr.value.split(" ");
				}
			}

		}

		if (node.matches(".cg-bar")) {
			if (!dataType) dataType = 'uint8_t';

			// top bottom left right
			metadata.direction = node.getAttribute("cg-dir");
			metadata.type = "bar";
		}

		if (node.matches(".cg-scrollable")) {
			metadata.type = "scrollable";
			metadata.cascading = true;
		}

		metadata.dataType = dataType;

		if (!metadata.type) return;

		metadata.id = this.allElements.push(node) - 1;
		Object.assign(this.active, metadata);
		this.allMetadata.push(this.active);
	}

	push() {
		this.stack.push(this.active);
		this.active = {};
	}

	pop() {
		const currentLayer = this.active;
		const prevLayer = this.stack.pop();
		this.active = prevLayer;

		const hasNodes = currentLayer.type;
		const hasChildren = currentLayer.children?.length > 0;
		if (!hasNodes && !hasChildren) return;

		if (!prevLayer.children) prevLayer.children = [];

		if (hasNodes) {
			prevLayer.children.push(currentLayer);
		} else/* if (hasChildren)*/ {
			// 减少树的高度
			prevLayer.children.push(...currentLayer.children);
		}

		if (currentLayer.cascading) {
			this.allMetadata.push({type: 'exit'});
		}
	}
}

/**
 * 执行演示模式：模拟数据变化
 * @param {CGUIScreen} ctx 屏幕上下文对象
 */
function RunDemo(ctx) {
	setInterval(() => {
		for (let i = 0; i < ctx.allMetadata.length; i++) {
			const m = ctx.allMetadata[i]; // 元数据
			const n = ctx.allElements[m.id]; // DOM 元素

			// 1. 处理 String 类型
			if (m.type === "string") {
				const chars = m.alphabet;
				let result = "";
				for (let j = 0; j < m.maxLength; j++) {
					result += chars.charAt(Math.floor(Math.random() * chars.length));
				}
				n.innerText = result;
			}

			// 2. 处理 Number 类型 (整数)
			else if (m.type === "number") {
				const maxVal = Math.pow(10, m.maxLength) - 1;
				const minVal = Math.pow(10, m.maxLength - 1);
				n.innerText = Math.floor(Math.random() * (maxVal - minVal + 1) + minVal).toString();
			}

			// 3. 处理 Fixed 类型 (定点小数)
			else if (m.type === "fixed") {
				const precision = m.digits;
				const randomVal = Math.random() * Math.pow(10, m.maxLength - precision - 1);
				n.innerText = randomVal.toFixed(precision).padStart(m.maxLength, '0');
			}

			// 4. 处理 Image 类型 (条件切换)
			else if (m.type === "image") {
				const keys = Object.keys(m.condition);
				if (keys.length > 0) {
					// 模拟随机切换状态
					const randKey = keys[Math.floor(Math.random() * keys.length)];
					// 先移除所有状态
					for (const key in m.condition) {
						n.classList.remove(...m.condition[key]);
					}
					if (m.orElse) n.classList.remove(...m.orElse);

					// 50% 概率展示 Condition，50% 展示 Else
					if (Math.random() > 0.5) {
						n.classList.add(...m.condition[randKey]);
					} else if (m.orElse) {
						n.classList.add(...m.orElse);
					}
				}
			}

			// 5. 处理 Bar 类型 (进度条)
			else if (m.direction) {
				const percent = Math.floor(Math.random() * 101); // 随机 0-100%
				const ch = n.children[0];
				if (m.direction === "left" || m.direction === "right") {
					ch.style.width = `${percent}%`;
				} else if (m.direction === "top" || m.direction === "bottom") {
					ch.style.height = `${percent}%`;
				}
			}
		}
	}, 1000);
}

document.addEventListener('DOMContentLoaded', CGUI_Init);

function createNestPath(root, nestPath) {
	nestPath.push(0);
	for (const child of root) {
		child.nestPath = nestPath.slice(0, -1);
		if (child.children)
			createNestPath(child.children, nestPath);
		nestPath[nestPath.length-1]++;
	}
	nestPath.pop();
}

function CGUI_Init() {
	const state = {};
	for (const el of document.querySelectorAll(".cg-screen")) {
		const id = el.id;
		if (!id) throw new Error("Missing ID for cg-screen");

		const ctx = new CGUIScreen(el);
		findElements(el, `[class*="cg-"]`, ctx);
		delete ctx.stack;
		delete ctx.active;
		if (ctx.root.children)
			createNestPath(ctx.root.children, []);
		delete ctx.root;

		state[id] = ctx;

		if (navigator.webdriver) {
			for (let i = 0; i < ctx.allMetadata.length; i++) {
				const m = ctx.allMetadata[i];
				const n = ctx.allElements[m.id];
				if (m.type === "image") {
					for (const key in m.condition) {
						n.classList.remove(...m.condition[key]);
					}
					n.classList.add(...m.orElse);
				}
			}
			el.classList.add('cg-render');
		} else {
			el.classList.add("cg-demo");
			RunDemo(ctx);
		}

	}

	window.CGUI_State = state;
}