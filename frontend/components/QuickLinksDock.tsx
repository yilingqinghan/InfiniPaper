import React from "react";
import { motion } from "framer-motion";
import { Globe2, ChevronLeft, ExternalLink } from "lucide-react";

const VENUES = [
  { name: "NeurIPS", url: "https://nips.cc/" },
  { name: "ICML", url: "https://icml.cc/" },
  { name: "ICLR", url: "https://iclr.cc/" },
  { name: "CVPR", url: "https://cvpr.thecvf.com/" },
  { name: "ACL", url: "https://aclweb.org/" },
  { name: "KDD", url: "https://www.kdd.org/" },
  { name: "WWW/TheWebConf", url: "https://www2024.thewebconf.org/" },
  { name: "SIGMOD", url: "https://sigmod.org/" },
  { name: "ISCA", url: "https://iscaconf.org/" },
  { name: "MICRO", url: "https://www.microarch.org/" },
];

const SITES = [
  { name: "arXiv", url: "https://arxiv.org/" },
  { name: "OpenAlex", url: "https://openalex.org/" },
  { name: "Semantic Scholar", url: "https://www.semanticscholar.org/" },
  { name: "Google Scholar", url: "https://scholar.google.com/" },
  { name: "Papers with Code", url: "https://paperswithcode.com/" },
  { name: "DBLP", url: "https://dblp.org/" },
  { name: "Crossref", url: "https://search.crossref.org/" },
];

export default function QuickLinksDock() {
  const [open, setOpen] = React.useState(true);

  return (
    <motion.div
      drag
      dragMomentum={false}
      className="fixed right-6 bottom-10 z-40"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-end gap-2">
        {open && (
          <div className="w-[300px] rounded-2xl border bg-white shadow/20 p-3">
            <div className="text-xs font-medium text-gray-600 flex items-center gap-2 mb-1">
              <Globe2 className="w-4 h-4" />
              顶刊/会议 & 常用站点
            </div>

            <div className="grid grid-cols-2 gap-1">
              {VENUES.map((v) => (
                <a
                  key={v.name}
                  href={v.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2 py-1 rounded-lg hover:bg-gray-50 border flex items-center justify-between"
                  title={v.url}
                >
                  {v.name}
                  <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                </a>
              ))}
            </div>

            <div className="text-xs font-medium text-gray-600 mt-3 mb-1">
              常用网站
            </div>
            <div className="grid grid-cols-2 gap-1">
              {SITES.map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2 py-1 rounded-lg hover:bg-gray-50 border flex items-center justify-between"
                  title={s.url}
                >
                  {s.name}
                  <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                </a>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setOpen((x) => !x)}
          className="rounded-full border bg-white w-10 h-10 flex items-center justify-center hover:bg-gray-50"
          title={open ? "收起" : "展开"}
        >
          <ChevronLeft
            className={`w-5 h-5 transition ${open ? "" : "rotate-180"}`}
          />
        </button>
      </div>
    </motion.div>
  );
}
