import {funcPrefix} from "./utils.js";

/**
 *
 * @param {string[]} screenNames
 * @param {number} targetFPS=60
 */
export function CodeGenTabs(screenNames, targetFPS = 60) {
	let header = `\n
extern volatile uint8_t ${funcPrefix}Tab;
void ${funcPrefix}Render_Thread(void);
`;

	let code = `
static union {
    uint8_t ptr;`;

	for (let screenName of screenNames) {
		code += `\n    ${funcPrefix}${screenName}_State _state_${screenName};`;
	}

	code += `
} _CG_STATES;

static const struct {
    void (*Init)(void* state);
    void (*Update)(void* state);
} _CG_PAGES[] = {`;

	for (let screenName of screenNames) {
		code += `\n    { (void (*)(void *))CG_${screenName}_Init, (void (*)(void *))CG_${screenName}_Update },`;
	}

	const frameTime = Math.floor(1000/targetFPS);

	code += `
};

volatile uint8_t ${funcPrefix}Tab; 
_IL_INLINE void ${funcPrefix}Render_Thread(void) {
    uint32_t sched;
    uint8_t lastTab = 0xFF;

    while(1) {
        uint8_t tab = ${funcPrefix}Tab;
        if (tab != lastTab) {
            Lock_lock(&lcdLock);
            _CG_PAGES[tab].Init(&_CG_STATES.ptr);
            Lock_unlock(&lcdLock);

            lastTab = tab;
            sched = YOS_getClock() + ${frameTime};
        }

        Lock_lock(&lcdLock);
        _CG_PAGES[tab].Update(&_CG_STATES.ptr);
        Lock_unlock(&lcdLock);

        if (!Thread_sleepUntil(sched)) sched += ${frameTime};
    }
}
`;

	return {header, code};
}