import React from 'react';
import chai, { expect } from 'chai';
import chaiEnzyme from 'chai-enzyme';
import { shallow } from 'enzyme';

import SelectOption from '../select-option';
import styles from '../select-option.css';

chai.use(chaiEnzyme());

describe('<SelectOption />', () => {
  const baseProps = {
    focusOption() {},
    selectValue() {},
    labelKey: 'name',
    valueArray: [],
  };

  it('applies focused classname when option has focus', () => {
    const option = {
      name: 'Seattle',
    };
    const props = Object.assign({}, baseProps, { focusedOption: option, option });
    const wrapper = shallow(<SelectOption {...props} />);
    expect(wrapper).to.have.className(styles.focused);
  });

  it('does not apply focused classname when option does not have focus', () => {
    const option = {
      name: 'Seattle',
    };
    const props = Object.assign({}, baseProps, { option });
    const wrapper = shallow(<SelectOption {...props} />);
    expect(wrapper).to.not.have.className(styles.focused);
  });

  describe('multi === true', () => {
    const multiBaseProps = Object.assign({}, baseProps, { multi: true });

    it('renders a checked input box when a given option is selected', () => {
      const option = {
        name: 'Seattle',
      };
      const props = Object.assign({}, multiBaseProps, { valueArray: [option], option });
      const wrapper = shallow(<SelectOption {...props} />);
      expect(wrapper.find('Input')).to.be.checked();
    });

    it('renders an unchecked input box when a given option is unselected', () => {
      const option = {
        name: 'Seattle',
      };
      const props = Object.assign({}, multiBaseProps, { option });
      const wrapper = shallow(<SelectOption {...props} />);
      expect(wrapper.find('Input')).to.not.be.checked();
    });
  });
});
