Offhand.json =
  Offhand.json ||
  (function () {
    function pad(value, width) {
      var text = String(value);
      while (text.length < width) text = "0" + text;
      return text;
    }

    function escapeString(value) {
      return value.replace(/[\\"\u0000-\u001f]/g, function (character) {
        switch (character) {
          case "\\":
            return "\\\\";
          case '"':
            return '\\"';
          case "\b":
            return "\\b";
          case "\f":
            return "\\f";
          case "\n":
            return "\\n";
          case "\r":
            return "\\r";
          case "\t":
            return "\\t";
          default:
            return "\\u" + pad(character.charCodeAt(0).toString(16), 4);
        }
      });
    }

    function isoDate(date) {
      try {
        return (
          date.getUTCFullYear() +
          "-" +
          pad(date.getUTCMonth() + 1, 2) +
          "-" +
          pad(date.getUTCDate(), 2) +
          "T" +
          pad(date.getUTCHours(), 2) +
          ":" +
          pad(date.getUTCMinutes(), 2) +
          ":" +
          pad(date.getUTCSeconds(), 2) +
          "." +
          pad(date.getUTCMilliseconds(), 3) +
          "Z"
        );
      } catch (error) {
        return String(date);
      }
    }

    function stringify(value, stack) {
      if (value === null || typeof value === "undefined") return "null";

      var type = typeof value;
      if (type === "number") return isFinite(value) ? String(value) : "null";
      if (type === "boolean") return value ? "true" : "false";
      if (type === "string") return '"' + escapeString(value) + '"';
      if (type !== "object") return "null";

      if (value instanceof Date) return '"' + isoDate(value) + '"';

      var index;
      for (index = 0; index < stack.length; index += 1) {
        if (stack[index] === value) return '"<cycle>"';
      }
      stack.push(value);

      var output;
      if (value instanceof Array) {
        var items = [];
        for (index = 0; index < value.length; index += 1) {
          items.push(stringify(value[index], stack));
        }
        output = "[" + items.join(",") + "]";
      } else {
        var fields = [];
        for (var key in value) {
          if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
          var item = value[key];
          if (typeof item === "function" || typeof item === "undefined") continue;
          fields.push('"' + escapeString(String(key)) + '":' + stringify(item, stack));
        }
        output = "{" + fields.join(",") + "}";
      }

      stack.pop();
      return output;
    }

    function parse(text) {
      if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(text);
      if (typeof text !== "string") throw new Error("JSON.parse expects a string");

      var sanitized = text
        .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
        .replace(/(?:^|:|,)(?:\s*\[)+/g, "");

      if (!/^[\],:{}\s]*$/.test(sanitized)) {
        throw new Error("Invalid JSON");
      }

      return eval("(" + text + ")");
    }

    return {
      stringify: function (value) {
        return stringify(value, []);
      },
      parse: parse,
    };
  })();
