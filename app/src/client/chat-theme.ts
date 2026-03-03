import type { ChatTheme } from "reachat";

/**
 * Custom reachat theme — default dark theme with all border-radius stripped.
 * Based on reachat's built-in chatTheme, replacing every rounded-* class with rounded-none.
 */
export const darkChatTheme: ChatTheme = {
  base: "dark:text-white text-gray-500",
  console: "flex w-full gap-4 h-full",
  companion: "w-full h-full overflow-hidden",
  empty: "text-center flex-1",
  appbar: "flex p-5",
  status: {
    base: "py-2 px-3 rounded-none bg-gray-100/50 dark:bg-gray-800/30",
    header: "flex items-center gap-2",
    icon: {
      base: "flex-shrink-0 w-4 h-4",
      loading: "text-blue-500 dark:text-blue-400",
      complete: "text-green-500 dark:text-green-400",
      error: "text-red-500 dark:text-red-400",
    },
    text: {
      base: "text-sm",
      loading: "text-gray-600 dark:text-gray-400",
      complete: "text-gray-600 dark:text-gray-400",
      error: "text-red-600 dark:text-red-400",
    },
    steps: {
      base: "mt-1 ml-6 space-y-0.5",
      step: {
        base: "flex items-center gap-2",
        icon: "flex-shrink-0 w-3.5 h-3.5",
        text: "text-sm",
        loading: "text-gray-500 dark:text-gray-500",
        complete: "text-gray-500 dark:text-gray-500",
        error: "text-red-500 dark:text-red-400",
      },
    },
  },
  sessions: {
    base: "overflow-auto",
    console:
      "min-w-[150px] w-[30%] max-w-[300px] dark:bg-[#11111F] bg-[#F2F3F7] p-5 rounded-none",
    companion: "w-full h-full",
    group:
      "text-xs dark:text-gray-400 text-gray-700 mt-4 hover:bg-transparent mb-1",
    create: "relative mb-4 rounded-none text-white",
    session: {
      base: "group my-1 rounded-none p-2 text-gray-500 border border-transparent hover:bg-gray-300 hover:border-gray-400 [&_svg]:text-gray-500 dark:text-typography dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:border-gray-700/50 dark:[&_svg]:text-gray-200",
      active:
        "border border-gray-300 hover:border-gray-400 text-gray-700 bg-gray-200 hover:bg-gray-300 dark:text-gray-500 dark:bg-gray-800/70 dark:border-gray-700/50 dark:text-white dark:border-gray-700/70 dark:hover:bg-gray-800/50 [&_button]:opacity-100!",
      delete:
        "[&>svg]:w-4 [&>svg]:h-4 opacity-0 group-hover:opacity-50!",
    },
  },
  messages: {
    base: "",
    console: "flex flex-col mx-5 flex-1 min-h-0",
    companion: "flex w-full h-full",
    back: "self-start p-0 my-2",
    inner: "flex-1 h-full flex flex-col",
    title: "text-base font-bold text-gray-500 dark:text-gray-200",
    date: "text-xs whitespace-nowrap text-gray-400",
    content:
      "mt-2 flex-1 overflow-auto [&_hr]:bg-gray-200 dark:[&_hr]:bg-gray-800/60",
    header: "flex justify-between items-center gap-2",
    showMore: "mb-4",
    message: {
      base: "mt-4 mb-4 flex flex-col p-0 rounded-none border-none bg-transparent",
      question:
        "relative font-semibold mb-4 px-4 py-4 pb-2 rounded-none text-typography border bg-gray-200 border-gray-300 text-gray-900 dark:bg-gray-900/60 dark:border-gray-700/50 dark:text-gray-100",
      response:
        "relative data-[compact=false]:px-4 text-gray-900 dark:text-gray-100",
      overlay:
        "overflow-y-hidden max-h-[350px] after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:h-16 after:bg-linear-to-b after:from-transparent dark:after:to-gray-900 after:to-gray-200",
      cursor: "inline-block w-1 h-4 bg-current",
      expand: "absolute bottom-1 right-1 z-10",
      scrollToBottom: {
        container:
          "absolute bottom-2 left-1/2 transform -translate-x-1/2 z-10",
        button: "rounded-none p-2 shadow-lg",
      },
      files: {
        base: "mb-2 flex flex-wrap gap-3",
        file: {
          base: "flex items-center gap-2 border border-gray-300 px-3 py-2 rounded-none cursor-pointer dark:border-gray-700",
          name: "text-sm text-gray-500 dark:text-gray-200",
        },
      },
      sources: {
        base: "my-4 flex flex-wrap gap-3",
        source: {
          base: "flex gap-2 border border-gray-200 px-4 py-2 rounded-none cursor-pointer dark:border-gray-700",
          companion: "flex-1 px-3 py-1.5",
          image: "max-w-10 max-h-10 rounded-none w-full h-fit self-center",
          title: "text-md block",
          url: "text-sm text-blue-400 underline",
        },
      },
      markdown: {
        copy: "sticky py-1 [&>svg]:w-4 [&>svg]:h-4 opacity-50",
        p: "mb-2",
        a: "text-blue-400 underline",
        table: "table-auto w-full m-2",
        th: "px-4 py-2 text-left font-bold border-b border-gray-500",
        td: "px-4 py-2",
        code: "m-2 rounded-none relative",
        toolbar:
          "text-xs dark:bg-gray-700/50 flex items-center justify-between px-2 py-1 rounded-none sticky top-0 backdrop-blur-md bg-gray-200",
        li: "mb-2 ml-6",
        ul: "mb-4 list-disc",
        ol: "mb-4 list-decimal",
      },
      footer: {
        base: "mt-3 flex gap-1.5",
        copy: "p-3 rounded-none [&>svg]:w-4 [&>svg]:h-4 opacity-50 hover:opacity-100! hover:bg-gray-200 hover:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-white text-gray-400",
        upvote:
          "p-3 rounded-none [&>svg]:w-4 [&>svg]:h-4 opacity-50 hover:opacity-100! hover:bg-gray-700/40 hover:text-white text-gray-400",
        downvote:
          "p-3 rounded-none [&>svg]:w-4 [&>svg]:h-4 opacity-50 hover:opacity-100! hover:bg-gray-700/40 hover:text-white text-gray-400",
        refresh:
          "p-3 rounded-none [&>svg]:w-4 [&>svg]:h-4 opacity-50 hover:opacity-100! hover:bg-gray-700/40 hover:text-white text-gray-400",
      },
    },
  },
  input: {
    base: "flex mt-4 relative",
    upload: "px-5 py-2 text-gray-400 size-10 dark:gray-500",
    input:
      "w-full border rounded-none px-3 py-2 pr-16 text-gray-500 border-gray-200 hover:bg-blue-100 hover:border-blue-500 after:hidden after:mx-10! bg-white [&>textarea]:w-full [&>textarea]:flex-none dark:border-gray-700/50 dark:text-gray-200 dark:bg-gray-950 dark:hover:bg-blue-950/40",
    actions: {
      base: "absolute flex gap-2 items-center right-5 inset-y-1/2 -translate-y-1/2 z-10",
      send: "px-3 py-3 hover:bg-primary-hover rounded-none bg-gray-200 hover:bg-gray-300 text-gray-500 dark:text-white light:text-gray-500 dark:bg-gray-800 dark:hover:bg-gray-700",
      stop: "px-2 py-2 bg-red-500 text-white rounded-none hover:bg-red-700",
    },
    popup: {
      base: "bg-white border border-gray-200 rounded-none shadow-lg overflow-hidden min-w-[200px] max-w-[300px] dark:bg-gray-900 dark:border-gray-700",
      content: "overflow-y-auto max-h-[250px]",
      item: "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
      itemHighlighted: "bg-gray-100 dark:bg-gray-800",
      itemIcon:
        "flex-shrink-0 w-5 h-5 text-gray-500 [&>svg]:w-full [&>svg]:h-full dark:text-gray-400",
      itemContent: "flex flex-col min-w-0 flex-1",
      itemLabel:
        "text-sm font-medium text-gray-900 truncate dark:text-gray-100",
      itemDescription: "text-xs text-gray-500 dark:text-gray-400 truncate",
      itemShortcut: "text-xs text-gray-400 dark:text-gray-500 ml-auto",
      empty:
        "px-3 py-4 text-sm text-center text-gray-500 dark:text-gray-400",
      loading:
        "flex items-center justify-center gap-2 px-3 py-4 text-gray-500 dark:text-gray-400",
    },
    tag: {
      base: "inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-none font-medium text-sm leading-[1.2] relative top-[1px]",
      mention: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
      command:
        "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
    },
    editor: {
      base: "outline-none w-full overflow-y-auto text-inherit font-inherit [&_.tiptap-paragraph]:m-0",
      container: "px-3 py-2 pr-16",
      placeholder:
        "[&_.is-editor-empty]:before:content-[attr(data-placeholder)] [&_.is-editor-empty]:before:text-gray-400 [&_.is-editor-empty]:before:dark:text-gray-500 [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:pointer-events-none",
    },
  },
  suggestions: {
    base: "flex flex-wrap gap-2 mt-4",
    item: {
      base: "rounded-none max-w-full py-2 px-4 bg-gray-100 border-gray-200 hover:bg-gray-200 hover:border-gray-300 text-gray-700 dark:bg-gray-800/50 dark:border-gray-700 dark:hover:bg-gray-700/70 dark:hover:border-gray-600 dark:text-gray-200 [&>svg]:w-4 [&>svg]:h-4 [&>svg]:text-blue-500 [&>svg]:dark:text-blue-400 [&>svg]:flex-shrink-0",
      icon: "w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0",
      text: "text-sm truncate",
    },
  },
  chart: {
    base: "my-6",
    title: "text-sm font-medium mb-2 text-gray-600 dark:text-gray-400",
    content: "flex items-center justify-center",
    error: {
      base: "my-4 p-4 border rounded-none border-red-300 bg-red-50 text-red-500 dark:border-red-700 dark:bg-red-900/20",
      title: "text-red-600 dark:text-red-400 text-sm font-medium mb-2",
      code: "text-xs overflow-auto",
    },
    warning: {
      base: "my-4 p-4 border rounded-none border-yellow-300 bg-yellow-50 text-yellow-600 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
      title:
        "text-yellow-600 dark:text-yellow-400 text-sm font-medium mb-2",
    },
  },
  component: {
    base: "my-4",
  },
};
