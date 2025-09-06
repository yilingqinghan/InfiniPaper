const VENUE_ABBR: [RegExp, string][] = [
    // 编译与体系结构领域（CCF A/B 类）
    [/(parallel architectures and compilation techniques|(^|\W)pact(\W|$))/i, "PACT"],
    [/(supercomputing|(^|\W)ics(\W|$))/i, "ICS"],
    [/(code generation and optimization|(^|\W)cgo(\W|$))/i, "CGO"],
    [/(hardware\/software co-design and system synthesis|(^|\W)codes\+isss(\W|$))/i, "CODES+ISSS"],
    [/(Architectural Support for Programming Languages and Operating Systems|(^|\W)ASPLOS(\W|$))/i, "ASPLOS"],
    [/(virtual execution environments|(^|\W)vee(\W|$))/i, "VEE"],
    [/(computer design|(^|\W)iccd(\W|$))/i, "ICCD"],
    [/(computer-aided design|(^|\W)iccad(\W|$))/i, "ICCAD"],
    [/(parallel processing|(^|\W)icpp(\W|$))/i, "ICPP"],
    [/(low power electronics and design|(^|\W)islped(\W|$))/i, "ISLPED"],
    [/(physical design|(^|\W)ispd(\W|$))/i, "ISPD"],
    [/(application-specific systems, architectures and processors|(^|\W)asap(\W|$))/i, "ASAP"],
    [/(high performance embedded architectures and compilers|(^|\W)hipeac(\W|$))/i, "HiPEAC"],
    [/(embedded software|(^|\W)emsoft(\W|$))/i, "EMSOFT"],
    [/(design automation|(^|\W)iccad(\W|$))/i, "ICCAD"],
    [/(computer-aided design|(^|\W)iccad(\W|$))/i, "ICCAD"],
    [/(china|(^|\W)china(\W|$))/i, "中文"],
    [/(intelligent computing|(^|\W)intelligent computing(\W|$))/i, "中文"],
    [/(International Symposium on Computer Architecture|(^|\W)ISCA(\W|$))/i, "ISCA"],
    [/(Compiler Construction|(^|\W)CC(\W|$))/i, "CC"],
    
    

    // 顶级期刊（编译与体系结构领域）
    [/(acm transactions on computer systems|(^|\W)tocs(\W|$))/i, "TOCS"],
    [/(acm transactions on Software Engineering and Methodology |(^|\W)TOSEM(\W|$))/i, "TOSEM"],
    
    [/(ieee transactions on parallel and distributed systems|(^|\W)tpds(\W|$))/i, "TPDS"],
    [/(ieee transactions on computers|(^|\W)tc(\W|$))/i, "TC"],
    [/(ieee transactions on computer-aided design of integrated circuits and systems|(^|\W)tcad(\W|$))/i, "TCAD"],
    [/(acm transactions on architecture and code optimization|(^|\W)taco(\W|$))/i, "TACO"],
    [/(journal of parallel and distributed computing|(^|\W)jpdc(\W|$))/i, "JPDC"],
    [/(ieee transactions on very large scale integration systems|(^|\W)tvlsi(\W|$))/i, "TVLSI"],
    [/(parallel computing|(^|\W)parco(\W|$))/i, "PARCO"],
    [/(ieee transactions on cloud computing|(^|\W)tcc(\W|$))/i, "TCC"],
    [/(acm journal on emerging technologies in computing systems|(^|\W)jetc(\W|$))/i, "JETC"],
    [/(cluster computing|(^|\W)cluster(\W|$))/i, "Cluster Computing"],
    [/(ACM Transactions on Information Systems|(^|\W)TOIS(\W|$))/i, "TOIS"],
    [/(Association for Computational Linguistics|(^|\W)ACL(\W|$))/i, "ACL"],
    [/(ACM Computing Surveys|(^|\W)CSUR(\W|$))/i, "综述·CSUR"],
    [/(ACM Comput. Surv.|(^|\W)CSUR(\W|$))/i, "综述·CSUR"],
    
    [/(Journal of systems and software|(^|\W)JSS(\W|$))/i, "JSS"],

    // 其他相关会议
    [/(design, automation & test in europe|(^|\W)date(\W|$))/i, "DATE"],
    [/(hot chips|(^|\W)hot chips(\W|$))/i, "HOT CHIPS"],
    [/(cluster computing|(^|\W)cluster(\W|$))/i, "CLUSTER"],
    [/(parallel and distributed systems|(^|\W)icpads(\W|$))/i, "ICPADS"],
    [/(european conference on parallel and distributed computing|(^|\W)euro-par(\W|$))/i, "Euro-Par"],
    [/(computing frontiers|(^|\W)cf(\W|$))/i, "CF"],
    [/(high performance computing and communications|(^|\W)hpcc(\W|$))/i, "HPCC"],
    [/(high performance computing, data and analytics|(^|\W)hipc(\W|$))/i, "HiPC"],
    [/(modeling, analysis, and simulation of computer and telecommunication systems|(^|\W)mascots(\W|$))/i, "MASCOTS"],
    [/(parallel and distributed processing with applications|(^|\W)ispa(\W|$))/i, "ISPA"],
    [/(ieee cluster, cloud and grid computing|(^|\W)ccgrid(\W|$))/i, "CCGRID"],
    [/(international test conference|(^|\W)itc(\W|$))/i, "ITC"],
    [/(large installation system administration conference|(^|\W)lisa(\W|$))/i, "LISA"],
    [/(mass storage systems and technologies|(^|\W)msst(\W|$))/i, "MSST"],
    [/(ieee real-time and embedded technology and applications symposium|(^|\W)rtas(\W|$))/i, "RTAS"],
    [/(communications of the ACM|(^|\W)CACM(\W|$))/i, "CACM"],

    // 人工智能领域（参考）
    [/(conference on neural information processing systems|(^|\W)neurips(\W|$))/i, "NeurIPS"],
    [/(machine learning|(^|\W)icml(\W|$))/i, "ICML"],
    [/(conference on computer vision and pattern recognition|(^|\W)cvpr(\W|$))/i, "CVPR"],
    [/(computer vision|(^|\W)iccv(\W|$))/i, "ICCV"],
    [/(european conference on computer vision|(^|\W)eccv(\W|$))/i, "ECCV"],
    [/(association for the advancement of artificial intelligence|(^|\W)aaai(\W|$))/i, "AAAI"],
    [/(international joint conference on artificial intelligence|(^|\W)ijcai(\W|$))/i, "IJCAI"],
    [/(conference on learning representations|(^|\W)iclr(\W|$))/i, "ICLR"],
    [/(conference on empirical methods in natural language processing|(^|\W)emnlp(\W|$))/i, "EMNLP"],
    [/(conference on neural information processing systems|(^|\W)neurips(\W|$))/i, "NeurIPS"],

    // 编程语言与软件工程领域（参考）
    [/(principles of programming languages|(^|\W)popl(\W|$))/i, "POPL"],
    [/(symposium on principles of programming languages|(^|\W)splash(\W|$))/i, "SPLASH"],
    [/(programming language design and implementation|(^|\W)pldi(\W|$))/i, "PLDI"],
    [/(functional programming|(^|\W)icfp(\W|$))/i, "ICFP"],
    [/(software engineering|(^|\W)icse(\W|$))/i, "ICSE"],
    [/(automated software engineering|(^|\W)ase(\W|$))/i, "ASE"],
    [/(software and systems engineering|(^|\W)fse(\W|$))/i, "FSE"],
    [/(programming languages and systems|(^|\W)popl(\W|$))/i, "POPL"],

    // 其他参考会议
    [/(design automation conference|(^|\W)dac(\W|$))/i, "DAC"],
    [/(very large data bases|(^|\W)vldb(\W|$))/i, "VLDB"],
    [/(sigmod|(^|\W)sigmod(\W|$))/i, "SIGMOD"],
    [/(the web conference|(^|\W)www(\W|$))/i, "WWW"],
    [/(supercomputing|(^|\W)sc(\W|$))/i, "SC"],
    [/(siggraph|(^|\W)siggraph(\W|$))/i, "SIGGRAPH"],
    [/(proceedings of the acm on programming languages|(^|\W)pacmpl(\W|$))/i, "PACMPL"],
    [/(object-oriented programming, systems, languages, and applications|(^|\W)oopsla(\W|$))/i, "OOPSLA"],
    [/(Research and Development inInformation Retrieval|(^|\W)sigir(\W|$))/i, "SIGIR"],
    [/(arxiv|(^|\W)arxiv(\W|$))/i, "预印本"],
];

export function abbrevVenue(venue?: string | null): string | null {
    if (!venue) return null;
    for (const [re, abbr] of VENUE_ABBR) if (re.test(venue)) return abbr;
    return null;
}

/** 顶尖会议/期刊缩写定义（Tier1） */
const TOP_TIER = new Set(["MICRO","PLDI","ISCA","ASPLOS","NeurIPS","ICML","CVPR","ICCV","ECCV","SIGMOD","VLDB","WWW","SC","SIGGRAPH","FAST","OSDI","ASE","FSE","ICSE","SOSP","SIGCOMM","NSDI","KDD","AAAI","IJCAI","TOSEM","SIGIR","OOPSLA","TOIS"]);
const preprint = new Set(["预印本"]);
const survey = new Set(["综述·CSUR"]);
const LOW_TIER = new Set(["CACM","Euro-Par","CF","HPCC","HiPC","MASCOTS","ISPA","ITC","LISA","MSST","RTAS","中文"]);
export function venueTier(abbr: string | null): 0 | 1 | 2 | 3 | 4 | 5{
    if (!abbr) return 0;
    if (preprint.has(abbr)) return 3;
    if (survey.has(abbr)) return 4;
    if (LOW_TIER.has(abbr)) return 5;
    return TOP_TIER.has(abbr) ? 1 : 2;
}