import { EditorView } from '@codemirror/view';
import { TodoItem, ProjectGroupContainer, ActionButton, ActionType } from ".";
import { randomUUID } from "crypto";
import { LanguageLine } from ".";
import type { ViewModel } from ".";
import { AddModal } from "src/component";

export default class TodoList implements ViewModel {
    // "n/c" will respresent order for items with no context (ex. sort:ctx:a,b,n/c,c)
    private static  NO_CONTEXT = "n/c";
    static HTML_CLS = "todotxt-list";

    private id: string;
    langLine: LanguageLine;
    items: TodoItem[];
    projectGroups: ProjectGroupContainer[];

    constructor(langLine: LanguageLine, items: TodoItem[]) {
        this.id = `${randomUUID()}`;
        this.langLine = langLine;
        this.items = items;
        this.sort();
    }

    static from(lineNumber: number, view: EditorView): { todoList: TodoList, from: number, to: number } {
        let i = lineNumber;
        const firstLine = view.state.doc.line(i++);
        const { langLine, errs }= LanguageLine.from(firstLine.text);
        if (errs.length) {
            console.error("LanguageLine errs: " + errs);
        };

        let to: number = firstLine.to;
        const items: TodoItem[] = [];
        while (i < view.state.doc.lines) {
            const line = view.state.doc.line(i++);
            if (line.text.startsWith("\`\`\`")) break;
            items.push(new TodoItem(line.text))
            to = line.to
        }

        return {
            todoList: new TodoList(langLine, items),
            from: firstLine.from,
            to: to
        };
    }

    render(): HTMLElement {
        const list = document.createElement("div");
        list.addClass(this.getHtmlCls());
        list.id = this.id;

        const addBtn = new ActionButton(ActionType.ADD, AddModal.ID, list.id).render();
        list.appendChild(addBtn);

        list.appendChild(this.langLine.render());

        list.innerHTML += this.items
            .filter(item => !item.projects().length)
            .map(item => item.render().outerHTML)
            .join("<br>");

        this.projectGroups.forEach(projGroup => list.appendChild(projGroup.render()));

        return list;
    }

    getId(): string {
        return this.id;
    }

    getHtmlCls(): string {
        return TodoList.HTML_CLS;
    }

    toString(): string {
        let res = this.langLine.toString() + "\n";
        res += this.items.map(item => item.toString()).join("\n");
        
        return res;
    }

    sort() {
        const ASC = "asc";

        // dates (creation, completion)

        // ctx
        const contextOrder = this.getContextOrder(this.items, this.langLine.sortFieldToOrder.get("ctx"));
        this.items.sort((a, b) => {

            let aScore = Number.MAX_VALUE;
            if (a.contexts().length) {
                a.contexts().forEach(ctx => aScore = Math.min(contextOrder.indexOf(ctx), aScore));
            } else if (contextOrder.indexOf(TodoList.NO_CONTEXT) !== -1) {
                aScore = Math.min(contextOrder.indexOf(TodoList.NO_CONTEXT), aScore);
            }

            let bScore = Number.MAX_VALUE;
            if (b.contexts().length) {
                b.contexts().forEach(ctx => bScore = Math.min(contextOrder.indexOf(ctx), bScore));
            } else if (contextOrder.indexOf(TodoList.NO_CONTEXT) !== -1) {
                bScore = Math.min(contextOrder.indexOf(TodoList.NO_CONTEXT), bScore);
            }

            return aScore - bScore;
        });

        // prio
        const prioritySortOrder = this.langLine.sortFieldToOrder.get("prio");
        if (prioritySortOrder) {
            this.items.sort((a, b) => {
                const aScore = a.priority()?.charCodeAt(0) || Number.MAX_VALUE;
                const bScore = b.priority()?.charCodeAt(0) || Number.MAX_VALUE;
                if (!prioritySortOrder.length || prioritySortOrder.first()! === ASC) {
                    return aScore - bScore;
                }
                return bScore - aScore;
            });
        }

        // due

        // status
        const statusSortOrder = this.langLine.sortFieldToOrder.get("status");
        if (statusSortOrder) {
            this.items.sort((a, b) => {
                const aScore = a.complete() ? 1 : 0;
                const bScore = b.complete() ? 1 : 0;
                if (!statusSortOrder.length || statusSortOrder.first()! === ASC) {
                    return aScore - bScore;
                }
                return bScore - aScore;
            });
        }

        // proj
        this.projectGroups = this.buildProjectGroups(this.items, this.langLine.collapsedProjectGroups);
        const projectOrder = this.getProjectOrder(this.items, this.langLine.sortFieldToOrder.get("proj"));
        this.projectGroups.sort((a, b) => {
            let aScore = projectOrder.findIndex(proj => proj === a.name);
            let bScore = projectOrder.findIndex(proj => proj === b.name);

            if (statusSortOrder) {
                if (a.isCompleted) aScore += this.projectGroups.length;
                if (b.isCompleted) bScore += this.projectGroups.length;
            }

            return aScore - bScore;
        });
        this.items.sort((a, b) => {
            let aScore: number | undefined;
            let bScore: number | undefined;
            a.projects().forEach(proj =>
                aScore =  Math.min(this.projectGroups.findIndex(group => group.name === proj),
                    aScore === undefined ? Number.MAX_VALUE : aScore)
            );
            b.projects().forEach(proj =>
                bScore = Math.min(this.projectGroups.findIndex(group => group.name === proj),
                    bScore === undefined ? Number.MAX_VALUE : bScore)
            );

            return (aScore || -1) - (bScore || -1);
        });

        for (const [i, item] of this.items.entries()) {
            item.setIdx(i);
        }
    }

    private buildProjectGroups(items: TodoItem[], collapsedProjectGroups: Set<string>): ProjectGroupContainer[] {
        const nameToProjectGroup: Map<string, ProjectGroupContainer> = new Map();
        items.forEach(item => {
            item.projects().forEach(proj => {
                const group = nameToProjectGroup.get(proj);
                if (group) {
                    group.items.push(item);
                } else {
                    nameToProjectGroup.set(proj, new ProjectGroupContainer(proj, [item], collapsedProjectGroups.has(proj)))
                }
            });
        });

        return Array.from(nameToProjectGroup.values());
    }

    private getProjectOrder(items: TodoItem[], projSortOrder: string[] | undefined): string[] {
        if (!items) throw "Invalid args!";

        // Get existing projects
        const projects: Set<string> = new Set();
        items.forEach(item => item.projects().forEach(proj => projects.add(proj)));

        // Filter out nonexistent projects from projectOrder
        const projectOrder = projSortOrder
            ? [...projSortOrder.filter(proj => projects.has(proj))]
            : [];

        // Append projects without sort order in alphabetical order
        const remainingProjects: string[] = Array.from(projects)
            .filter(proj => !projectOrder.contains(proj))
            .sort();

        return projectOrder.concat(remainingProjects);
    }

    private getContextOrder(items: TodoItem[], ctxSortOrder: string[] | undefined): string[] {
        if (!items) throw "Invalid args!";

        // Get existing contexts
        const contexts: Set<string> = new Set();
        items.forEach(item => item.contexts().forEach(ctx => contexts.add(ctx)));

        // Filter out nonexistent contexts
        const contextOrder = ctxSortOrder
            ? [...ctxSortOrder.filter(ctx => contexts.has(ctx) || ctx === TodoList.NO_CONTEXT)]
            : [];

        // Append contexts without sort order in alphabetical order
        const remainingContexts: string[] = Array.from(contexts)
            .filter(ctx => !contextOrder.contains(ctx))
            .sort();

        return contextOrder.concat(remainingContexts);
    }
}