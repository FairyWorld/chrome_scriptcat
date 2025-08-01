import ServiceWorkerManager from "./app/service/service_worker";
import LoggerCore from "./app/logger/core";
import DBWriter from "./app/logger/db_writer";
import { LoggerDAO } from "./app/repo/logger";
import { ExtensionMessage } from "@Packages/message/extension_message";
import { Server } from "@Packages/message/server";
import { MessageQueue } from "@Packages/message/message_queue";
import { ServiceWorkerMessageSend } from "@Packages/message/window_message";
import migrate from "./app/migrate";
import { fetchIconByDomain } from "./app/service/service_worker/fetch";
import { msgResponse } from "./app/service/service_worker/utils";

migrate();

const OFFSCREEN_DOCUMENT_PATH = "src/offscreen.html";

let creating: Promise<void> | null;

async function hasDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });
  return existingContexts.length > 0;
}

async function setupOffscreenDocument() {
  //if we do not have a document, we are already setup and can skip
  if (!(await hasDocument())) {
    // create offscreen document
    if (creating) {
      await creating;
    } else {
      creating = chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [
          chrome.offscreen.Reason.BLOBS,
          chrome.offscreen.Reason.CLIPBOARD,
          chrome.offscreen.Reason.DOM_SCRAPING,
          chrome.offscreen.Reason.LOCAL_STORAGE,
        ],
        justification: "offscreen page",
      });

      await creating;
      creating = null;
    }
  }
}

async function main() {
  // 初始化管理器
  const message = new ExtensionMessage(true);
  // 初始化日志组件
  const loggerCore = new LoggerCore({
    writer: new DBWriter(new LoggerDAO()),
    labels: { env: "service_worker" },
  });
  loggerCore.logger().debug("service worker start");
  const server = new Server("serviceWorker", message);
  const messageQueue = new MessageQueue();
  const manager = new ServiceWorkerManager(server, messageQueue, new ServiceWorkerMessageSend());
  manager.initManager();
  // 初始化沙盒环境
  await setupOffscreenDocument();
}

const apiActions: {
  [key: string]: (message: any, _sender: chrome.runtime.MessageSender) => Promise<any> | any;
} = {
  async "fetch-icon-by-domain"(message: any, _sender: chrome.runtime.MessageSender) {
    const { domain } = message;
    return await fetchIconByDomain(domain);
  },
};

chrome.runtime.onMessage.addListener((req, sender, sendReseponse) => {
  const f = apiActions[req.message ?? ""];
  if (f) {
    let res;
    try {
      res = f(req, sender);
    } catch (e: any) {
      sendReseponse(msgResponse(1, e));
      return false;
    }
    if (typeof res?.then === "function") {
      res.then(sendReseponse).catch((e: Error) => {
        sendReseponse(msgResponse(1, e));
      });
      return true;
    } else {
      sendReseponse(msgResponse(0, res));
      return false;
    }
  }
});

main();
