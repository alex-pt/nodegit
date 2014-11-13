var NodeGit = require("../");
NodeGit.Enums = {};

/* jshint ignore:start */
{%each%}
var {{ owner }} = NodeGit.{{ owner }};

  {% each enums as enum %}
{{ owner }}.{{ enum.JsName }} = {
    {% each enum.values as value %}
  {{ value.JsName }}: {{ value.value }},
    {% endeach %}
};
  {% endeach %}

{% endeach %}
/* jshint ignore:end */
