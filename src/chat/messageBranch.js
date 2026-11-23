/**
 * Owns logical Message/Swipe branch resolution and atomic message-branch mutation.
 * It does not own Diff metadata or persistence.
 */
import { generationLifecycle } from '../host/generationLifecycle.js';
import { getAppContext } from '../host/appContext.js';
import { getMessageWriteCoordinator } from '../integrations/messageWriteCoordinator.js';

function isObject(value) {
    return !!(value && typeof value === 'object');
}

function deleteValue(target, key) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) return false;
    delete target[key];
    return true;
}

export function getMessageSwipeIndex(msg) {
    if (!isObject(msg) || !Array.isArray(msg.swipes)) return -1;
    const index = msg.swipe_id;
    if (!Number.isInteger(index) || index < 0 || index >= msg.swipes.length) return -1;
    const swipe = msg.swipes[index];
    return typeof swipe === 'string' || (isObject(swipe) && typeof swipe.mes === 'string') ? index : -1;
}

export function getMessageDiffBranchKey(msg) {
    const swipeIndex = getMessageSwipeIndex(msg);
    if (swipeIndex >= 0) return `swipe:${swipeIndex}`;

    // saveReply awaits MESSAGE_RECEIVED before allocating initial Swipe 0.
    // Only the bound receipt target has that logical branch before allocation.
    const session = generationLifecycle.getActive();
    if (session?.finalSource === 'message-received'
        && session.messageRef === msg
        && generationLifecycle.validate(session.generationId).ok) {
        if (msg.swipe_id === undefined && msg.swipeId === undefined && msg.swipes === undefined) return 'swipe:0';
        // TT reserves the new last slot before notifying listeners and fills it after receipt.
        const index = msg.swipe_id;
        if (session.mode === 'swipe' && Array.isArray(msg.swipes) && Number.isInteger(index)
            && index > 0 && index === msg.swipes.length - 1 && !Object.hasOwn(msg.swipes, index)) {
            return `swipe:${index}`;
        }
    }
    return msg?.swipes === undefined ? 'main' : null;
}

export function setCurrentSwipeText(msg, text) {
    const swipeIndex = getMessageSwipeIndex(msg);
    if (swipeIndex < 0) return false;

    const nextText = String(text ?? '');
    const currentSwipe = msg.swipes[swipeIndex];
    if (typeof currentSwipe === 'string') {
        if (currentSwipe === nextText) return false;
        msg.swipes[swipeIndex] = nextText;
        return true;
    }

    if (isObject(currentSwipe) && typeof currentSwipe.mes === 'string') {
        if (currentSwipe.mes === nextText) return false;
        currentSwipe.mes = nextText;
        return true;
    }

    return false;
}

export function syncCurrentSwipeExtra(msg) {
    const swipeIndex = getMessageSwipeIndex(msg);
    if (swipeIndex < 0 || !Array.isArray(msg?.swipe_info)) return false;

    const swipeInfo = msg.swipe_info[swipeIndex];
    if (!isObject(swipeInfo)) return false;

    // Only the display override belongs to this text operation. Memory plugins
    // own per-swipe anchors/receipts which may intentionally differ from msg.extra.
    if (!isObject(swipeInfo.extra)) return false;
    if (Object.prototype.hasOwnProperty.call(msg.extra || {}, 'display_text')) {
        swipeInfo.extra.display_text = structuredClone(msg.extra.display_text);
        return true;
    }
    return deleteValue(swipeInfo.extra, 'display_text');
}

/**
 * 原子写入当前消息正文和当前已落槽的 swipe。
 * 只要消息声明了 swipes，当前槽就必须真实存在；否则不修改任何数据。
 */
export function commitCurrentMessageText(msg, text, expectedBranchKey = '') {
    const coordinator = getMessageWriteCoordinator();
    const chat = getAppContext().chat;
    if (coordinator.isOwner(chat, 'response-linter') || coordinator.isOwner(chat, 'veridis-save')) {
        return { ok: false, changed: false, reason: 'shared-write-busy' };
    }
    if (!isObject(msg) || typeof msg.mes !== 'string') {
        return { ok: false, changed: false, reason: 'message-text-missing', branchKey: 'main' };
    }

    const branchKey = getMessageDiffBranchKey(msg);
    if (!branchKey) {
        return { ok: false, changed: false, reason: 'swipe-slot-not-materialized', branchKey };
    }
    if (expectedBranchKey && branchKey !== expectedBranchKey) {
        return { ok: false, changed: false, reason: 'message-branch-changed', branchKey };
    }

    const nextText = String(text ?? '');
    if (Array.isArray(msg.swipes)) {
        const swipeIndex = getMessageSwipeIndex(msg);
        if (swipeIndex < 0) {
            return { ok: false, changed: false, reason: 'swipe-slot-not-materialized', branchKey };
        }

        const swipe = msg.swipes[swipeIndex];
        const currentSwipeText = typeof swipe === 'string' ? swipe : swipe.mes;
        const changed = msg.mes !== nextText || currentSwipeText !== nextText;
        msg.mes = nextText;
        if (typeof swipe === 'string') msg.swipes[swipeIndex] = nextText;
        else swipe.mes = nextText;
        return { ok: true, changed, reason: '', branchKey: `swipe:${swipeIndex}`, swipeIndex };
    }

    const changed = msg.mes !== nextText;
    msg.mes = nextText;
    return { ok: true, changed, reason: '', branchKey, swipeIndex: -1 };
}

export function clearMessageDisplayText(msg) {
    if (!isObject(msg) || !isObject(msg.extra)) return false;
    return deleteValue(msg.extra, 'display_text');
}
