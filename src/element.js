function getContentNodes (el) {
    const fragment = document.createElement('content');
    while (el.childNodes.length) {
        fragment.appendChild(el.childNodes[0]);
    }
    return fragment;
}


function wrapped (viewClass) {

    return class ViewElement extends HTMLElement {
        createdCallback () {
            this._content = getContentNodes(this);
            this.view = new viewClass({'el': this, '_content': this._content});
            this.view._content = this._content;
            this.view?.setModel();
        }
    }
}

export const defineView = (elementName, ViewClass) => customElements.define(elementName, wrapped(ViewClass));

