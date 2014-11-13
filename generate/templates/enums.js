var NodeGit = require("../");
NodeGit.Enums = {};

/* jshint ignore:start */
{%each%}
var {{ type }} = NodeGit.{{ type }};

{% each enums as enum %}
{{ type }}.{{ enum.name }} = {
  {% each enum.values as value %}
  {{ value.name }}: {{ value.value }},
{% endeach %}
};

{% endeach %}

{% endeach %}
/* jshint ignore:end */
